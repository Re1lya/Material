#!/usr/bin/env python3
"""Import one immutable ModelScope snapshot into Artifact Keeper.

The importer is deliberately CPU-only.  It downloads a pinned ModelScope
revision into a unique staging directory, creates a canonical file manifest,
and publishes files to Artifact Keeper with the manifest uploaded last as the
release marker.  Existing files are read back and compared before they are
treated as a successful retry; a different byte stream is never overwritten.

Credentials are read from files so they do not appear in command arguments or
logs.  The script does not know anything about Kubernetes or NPU resources and
can therefore be run as a bounded CPU Job or on an external staging host.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable


REVISION_RE = re.compile(r"^[0-9a-f]{8,64}$")
MODEL_ID_RE = re.compile(r"^[^/\s]+/[^/\s]+$")
SAFE_PREFIX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def read_secret_file(name: str) -> str:
    path = pathlib.Path(required(name))
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise RuntimeError(f"credential file is empty: {name}")
    return value


def validate_revision(revision: str) -> None:
    if not REVISION_RE.fullmatch(revision):
        raise RuntimeError(
            "MODEL_SCOPE_REVISION must be an immutable lowercase hexadecimal "
            "revision (8-64 characters), not a branch or tag"
        )


def validate_relative_path(value: str) -> pathlib.PurePosixPath:
    path = pathlib.PurePosixPath(value)
    if path.is_absolute() or not value or ".." in path.parts:
        raise RuntimeError(f"unsafe artifact path: {value!r}")
    return path


def canonical_manifest(manifest: dict) -> bytes:
    normalized = {
        "schemaVersion": manifest["schemaVersion"],
        "files": sorted(manifest["files"], key=lambda item: item["path"]),
    }
    return json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def manifest_digest(manifest: dict) -> str:
    return "sha256:" + hashlib.sha256(canonical_manifest(manifest)).hexdigest()


def hash_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def iter_snapshot_files(root: pathlib.Path) -> Iterable[tuple[pathlib.Path, str]]:
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        relative_path = validate_relative_path(relative)
        # ModelScope may leave downloader state in these directories.  It is
        # not part of a model release and must never become a runtime artifact.
        if relative_path.parts[0] in {".cache", ".modelscope"}:
            continue
        yield path, relative


def build_manifest(root: pathlib.Path) -> dict:
    files = []
    for path, relative in iter_snapshot_files(root):
        files.append(
            {
                "path": relative,
                "size": path.stat().st_size,
                "sha256": hash_file(path),
            }
        )
    if not files:
        raise RuntimeError("ModelScope snapshot contains no publishable files")
    return {"schemaVersion": 1, "files": files}


def encoded_path(*parts: str) -> str:
    return "/".join(
        urllib.parse.quote(part, safe="")
        for part in parts
        if part
    )


def artifact_url(base_url: str, repository: str, action: str, prefix: str, relative: str) -> str:
    return (
        f"{base_url.rstrip('/')}/api/v1/repositories/"
        f"{urllib.parse.quote(repository, safe='')}/{action}/"
        f"{encoded_path(prefix, *validate_relative_path(relative).parts)}"
    )


def stream_digest(response, destination: pathlib.Path | None = None) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    output = destination.open("wb") if destination else None
    try:
        for block in iter(lambda: response.read(8 * 1024 * 1024), b""):
            digest.update(block)
            size += len(block)
            if output:
                output.write(block)
        if output:
            output.flush()
            os.fsync(output.fileno())
    finally:
        if output:
            output.close()
    return digest.hexdigest(), size


def existing_matches(
    url: str,
    token: str,
    expected_sha256: str,
    expected_size: int,
) -> bool:
    request = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            actual_sha256, actual_size = stream_digest(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise RuntimeError(f"Artifact Keeper read failed with HTTP {error.code}") from error
    return actual_sha256 == expected_sha256 and actual_size == expected_size


def put_file(url: str, token: str, path: pathlib.Path) -> None:
    def body():
        with path.open("rb") as stream:
            while block := stream.read(8 * 1024 * 1024):
                yield block

    request = urllib.request.Request(
        url,
        method="PUT",
        data=body(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Length": str(path.stat().st_size),
            "Content-Type": "application/octet-stream",
            # A release marker is uploaded last; this header also protects
            # against an API implementation that supports conditional PUT.
            "If-None-Match": "*",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            if response.status not in {200, 201, 204}:
                raise RuntimeError(f"Artifact Keeper upload returned HTTP {response.status}")
    except urllib.error.HTTPError as error:
        if error.code not in {409, 412}:
            raise RuntimeError(f"Artifact Keeper upload failed with HTTP {error.code}") from error


def publish_file(
    base_url: str,
    repository: str,
    prefix: str,
    relative: str,
    path: pathlib.Path,
    token: str,
) -> None:
    url = artifact_url(base_url, repository, "download", prefix, relative)
    if existing_matches(url, token, hash_file(path), path.stat().st_size):
        return
    # The API uses the same coordinate for PUT /artifacts and GET /download.
    upload_url = artifact_url(base_url, repository, "artifacts", prefix, relative)
    put_file(upload_url, token, path)
    if not existing_matches(url, token, hash_file(path), path.stat().st_size):
        raise RuntimeError(f"uploaded file failed read-back verification: {relative}")


def download_snapshot(model_id: str, revision: str, destination: pathlib.Path, token: str) -> None:
    # Import lazily so manifest/unit tests can run without the ModelScope SDK.
    try:
        from modelscope import snapshot_download
    except ImportError as error:  # pragma: no cover - exercised only in the image
        raise RuntimeError("ModelScope SDK is not installed in the importer image") from error

    os.environ["MODELSCOPE_API_TOKEN"] = token
    result = snapshot_download(
        model_id=model_id,
        revision=revision,
        local_dir=str(destination),
        ignore_file_pattern=[".cache/*", ".modelscope/*"],
    )
    # The SDK may return a different path when local_dir is normalized.  Copy
    # only the resulting files into our own staging directory to keep the
    # publication code independent from SDK internals.
    returned = pathlib.Path(result)
    if returned.resolve() != destination.resolve() and returned.is_dir():
        for source in returned.iterdir():
            target = destination / source.name
            if target.exists():
                continue
            shutil.move(str(source), target)


def main() -> int:
    model_id = required("MODELSCOPE_MODEL_ID")
    revision = required("MODELSCOPE_REVISION")
    if not MODEL_ID_RE.fullmatch(model_id):
        raise RuntimeError("MODELSCOPE_MODEL_ID must be in owner/model form")
    validate_revision(revision)

    base_url = required("AK_BASE_URL")
    repository = required("AK_REPOSITORY")
    prefix = required("AK_ARTIFACT_PREFIX").strip("/")
    if repository != "model-artifacts":
        raise RuntimeError("the importer is restricted to Artifact Keeper model-artifacts")
    if not SAFE_PREFIX_RE.fullmatch(prefix):
        raise RuntimeError("AK_ARTIFACT_PREFIX contains unsafe characters")

    staging_root = pathlib.Path(os.environ.get("STAGING_ROOT", "/tmp/model-import"))
    staging_root.mkdir(parents=True, exist_ok=True)
    lock_path = staging_root / ".import.lock"
    modelscope_token = read_secret_file("MODELSCOPE_TOKEN_FILE")
    artifact_token = read_secret_file("AK_PUBLISHER_TOKEN_FILE")

    with lock_path.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix="snapshot-", dir=staging_root) as directory:
            snapshot = pathlib.Path(directory)
            download_snapshot(model_id, revision, snapshot, modelscope_token)
            manifest = build_manifest(snapshot)
            digest = manifest_digest(manifest)
            manifest["source"] = {
                "type": "modelscope",
                "modelId": model_id,
                "revision": revision,
            }
            manifest["manifestDigest"] = digest
            manifest_path = snapshot / "manifest.json"
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            for index, entry in enumerate(manifest["files"], start=1):
                print(f"publishing {index}/{len(manifest['files'])}: {entry['path']}", flush=True)
                publish_file(
                    base_url,
                    repository,
                    prefix,
                    entry["path"],
                    snapshot / validate_relative_path(entry["path"]),
                    artifact_token,
                )

            # The manifest is the immutable release marker.  It is deliberately
            # uploaded after every content file has passed read-back validation.
            publish_file(base_url, repository, prefix, "manifest.json", manifest_path, artifact_token)
            print(
                json.dumps(
                    {
                        "modelId": model_id,
                        "revision": revision,
                        "artifactPrefix": prefix,
                        "manifestDigest": digest,
                        "fileCount": len(manifest["files"]),
                        "sizeBytes": sum(item["size"] for item in manifest["files"]),
                    },
                    sort_keys=True,
                )
            )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
