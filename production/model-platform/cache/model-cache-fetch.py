#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


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


def hash_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_file(path: pathlib.Path, entry: dict) -> bool:
    return (
        path.is_file()
        and path.stat().st_size == entry["size"]
        and hash_file(path) == entry["sha256"]
    )


def load_manifest(base_url: str, repository: str, artifact_prefix: str, token: str) -> dict:
    encoded_prefix = "/".join(
        urllib.parse.quote(part, safe="")
        for part in (artifact_prefix.strip("/"),)
        if part
    )
    # Keep the manifest beside the model files in Artifact Keeper.  The
    # importer uploads it last, so a successful read is also the publication
    # marker for an immutable artifact version.
    url = (
        f"{base_url.rstrip('/')}/api/v1/repositories/"
        f"{urllib.parse.quote(repository, safe='')}/download/{encoded_prefix}/manifest.json"
    )
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"failed to read Artifact Keeper manifest: HTTP {error.code}") from error


def download(url: str, token: str, destination: pathlib.Path, entry: dict) -> None:
    partial = destination.with_name(destination.name + ".partial")
    partial.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, 6):
        offset = partial.stat().st_size if partial.exists() else 0
        headers = {"Authorization": f"Bearer {token}"}
        if offset:
            headers["Range"] = f"bytes={offset}-"

        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                append = offset > 0 and response.status == 206
                mode = "ab" if append else "wb"
                with partial.open(mode) as stream:
                    shutil.copyfileobj(response, stream, 8 * 1024 * 1024)
                    stream.flush()
                    os.fsync(stream.fileno())
        except (OSError, urllib.error.URLError) as error:
            if attempt == 5:
                raise RuntimeError(f"download failed after 5 attempts: {entry['path']}") from error
            time.sleep(min(30, attempt * 5))
            continue

        if valid_file(partial, entry):
            partial.replace(destination)
            return

        if partial.exists() and partial.stat().st_size >= entry["size"]:
            partial.unlink()

    raise RuntimeError(f"download validation failed: {entry['path']}")


def main() -> int:
    base_url = required("AK_BASE_URL").rstrip("/")
    repository = required("AK_REPOSITORY")
    artifact_prefix = required("AK_ARTIFACT_PREFIX").strip("/")
    model_id = required("MODEL_ID")
    expected_digest = required("MANIFEST_DIGEST")
    cache_root = pathlib.Path(required("CACHE_ROOT"))
    token_path = pathlib.Path(required("TOKEN_FILE"))

    token = token_path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("Artifact Keeper token is empty")

    manifest_file = os.environ.get("MANIFEST_FILE", "").strip()
    if manifest_file:
        manifest = json.loads(pathlib.Path(manifest_file).read_text(encoding="utf-8"))
    else:
        manifest = load_manifest(base_url, repository, artifact_prefix, token)
    actual_digest = "sha256:" + hashlib.sha256(canonical_manifest(manifest)).hexdigest()
    if actual_digest != expected_digest:
        raise RuntimeError(
            f"manifest digest mismatch: expected {expected_digest}, got {actual_digest}"
        )

    safe_digest = expected_digest.replace(":", "-")
    target_relative = os.environ.get("CACHE_TARGET_RELATIVE", "").strip()
    if target_relative:
        relative_target = pathlib.PurePosixPath(target_relative)
        if relative_target.is_absolute() or ".." in relative_target.parts:
            raise RuntimeError("CACHE_TARGET_RELATIVE must stay inside CACHE_ROOT")
        target = cache_root.joinpath(*relative_target.parts)
    else:
        target = cache_root / model_id / safe_digest
    lock_path = cache_root / ".locks" / f"{model_id}-{safe_digest}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    with lock_path.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)

        ready = target / "READY"
        if ready.is_file():
            for entry in manifest["files"]:
                if not valid_file(target / entry["path"], entry):
                    raise RuntimeError(f"existing cache failed validation: {entry['path']}")
            print(f"cache already ready: {target}")
            return 0

        if target.exists():
            raise RuntimeError(f"incomplete target already exists; manual inspection required: {target}")

        staging = cache_root / ".staging" / f"{model_id}-{safe_digest}-{os.getpid()}"
        staging.mkdir(parents=True, exist_ok=False)

        try:
            for index, entry in enumerate(manifest["files"], start=1):
                relative = pathlib.PurePosixPath(entry["path"])
                if relative.is_absolute() or ".." in relative.parts:
                    raise RuntimeError(f"unsafe manifest path: {entry['path']}")
                encoded_path = "/".join(
                    urllib.parse.quote(part, safe="")
                    for part in (artifact_prefix, *relative.parts)
                )
                url = f"{base_url}/api/v1/repositories/{repository}/download/{encoded_path}"
                print(f"[{index}/{len(manifest['files'])}] {entry['path']}", flush=True)
                download(url, token, staging / relative, entry)

            (staging / "READY").write_text(
                json.dumps(
                    {
                        "manifestDigest": expected_digest,
                        "fileCount": len(manifest["files"]),
                        "completedAtEpoch": int(time.time()),
                    },
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            target.parent.mkdir(parents=True, exist_ok=True)
            staging.replace(target)
            print(f"cache ready: {target}")
            return 0
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
