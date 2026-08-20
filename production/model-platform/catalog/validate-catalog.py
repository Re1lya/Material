#!/usr/bin/env python3
"""Validate the model catalog: schema, immutable digest and cross-reference checks.

Expects:
- catalog-dir: directory containing ModelVersion/ModelRuntimeProfile YAML files
  and companion `<name>.manifest.json` files.
- schema-dir: directory containing modelversion.schema.json and
  modelruntimeprofile.schema.json.

Exit status 0 means PASS (or SKIP when no catalog directory is present).
Any schema violation, manifest digest mismatch or dangling runtime profile
reference exits non-zero.
"""
import argparse
import hashlib
import json
import pathlib
import sys

from jsonschema import Draft202012Validator
from ruamel.yaml import YAML


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


def load_yaml(path: pathlib.Path) -> dict:
    yaml_loader = YAML(typ="safe")
    with path.open(encoding="utf-8") as stream:
        return yaml_loader.load(stream)


def collect_errors(validator, document: dict) -> list:
    return sorted(
        (error.message for error in validator.iter_errors(document)),
        key=str,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog-dir", type=pathlib.Path, required=True)
    parser.add_argument("--schema-dir", type=pathlib.Path, required=True)
    args = parser.parse_args()

    schema_dir = args.schema_dir
    mv_schema = json.loads((schema_dir / "modelversion.schema.json").read_text(encoding="utf-8"))
    rp_schema = json.loads((schema_dir / "modelruntimeprofile.schema.json").read_text(encoding="utf-8"))

    catalog_dir = args.catalog_dir
    if not catalog_dir.is_dir():
        print("catalog_validation=SKIP catalog directory absent")
        return 0

    versions = []
    profiles = []
    errors = []
    for path in sorted(catalog_dir.glob("*.yaml")):
        document = load_yaml(path)
        kind = document.get("kind")
        if kind == "ModelVersion":
            versions.append((path, document))
        elif kind == "ModelRuntimeProfile":
            profiles.append((path, document))
        else:
            errors.append(f"{path}: unsupported catalog kind {kind!r}")

    profile_names = set()
    for path, document in profiles:
        errors.extend(f"{path}: {message}" for message in collect_errors(Draft202012Validator(rp_schema), document))
        name = document.get("metadata", {}).get("name")
        if name:
            profile_names.add(name)

    for path, document in versions:
        errors.extend(f"{path}: {message}" for message in collect_errors(Draft202012Validator(mv_schema), document))

        name = document.get("metadata", {}).get("name")
        if name == "qwen3.8-27b-w8a8":
            source = document.get("spec", {}).get("source", {})
            model_spec = document.get("spec", {})
            if source.get("type") != "modelscope":
                errors.append(f"{path}: Qwen3.8 ModelVersion source.type must be modelscope")
            if source.get("modelId") != model_spec.get("modelId"):
                errors.append(f"{path}: ModelScope modelId must match spec.modelId")
            if source.get("revision") != model_spec.get("revision"):
                errors.append(f"{path}: ModelScope revision must match spec.revision")
            if model_spec.get("format", {}).get("quantization") != "w8a8":
                errors.append(f"{path}: Qwen3.8 final format.quantization must be w8a8")
            quantization = model_spec.get("quantization", {})
            if quantization.get("tool") != "msmodelslim":
                errors.append(f"{path}: Qwen3.8 quantization.tool must be msmodelslim")
            if quantization.get("sourcePrecision") != "bf16":
                errors.append(f"{path}: Qwen3.8 quantization.sourcePrecision must be bf16")
            if quantization.get("target") != "w8a8":
                errors.append(f"{path}: Qwen3.8 quantization.target must be w8a8")
            if not str(model_spec.get("artifact", {}).get("path", "")).startswith("qwen3.8-27b/w8a8/"):
                errors.append(f"{path}: Qwen3.8 artifact.path must be under qwen3.8-27b/w8a8/")
            input_artifact = quantization.get("inputArtifact", {})
            if not str(input_artifact.get("path", "")).startswith("qwen3.8-27b/bf16/"):
                errors.append(f"{path}: Qwen3.8 inputArtifact.path must be under qwen3.8-27b/bf16/")
        artifact = document.get("spec", {}).get("artifact", {})
        manifest_path = catalog_dir / f"{name}.manifest.json"
        if not manifest_path.exists():
            errors.append(f"{path}: manifest file {manifest_path.name} not found")
            continue

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        actual_digest = "sha256:" + hashlib.sha256(canonical_manifest(manifest)).hexdigest()
        if artifact.get("manifestDigest") != actual_digest:
            errors.append(
                f"{path}: manifestDigest mismatch declared={artifact.get('manifestDigest')} actual={actual_digest}"
            )

        declared_count = artifact.get("fileCount")
        actual_count = len(manifest["files"])
        if declared_count != actual_count:
            errors.append(f"{path}: fileCount mismatch declared={declared_count} actual={actual_count}")

        declared_size = artifact.get("sizeBytes")
        actual_size = sum(int(entry["size"]) for entry in manifest["files"])
        if declared_size != actual_size:
            errors.append(f"{path}: sizeBytes mismatch declared={declared_size} actual={actual_size}")

        for reference in document.get("spec", {}).get("compatibility", {}).get("runtimeProfiles", []):
            if reference not in profile_names:
                errors.append(f"{path}: references unknown runtime profile {reference!r}")

    if errors:
        for message in errors:
            print(f"ERROR: {message}", file=sys.stderr)
        print("catalog_validation=FAIL", file=sys.stderr)
        return 1

    print(f"catalog_validation=PASS versions={len(versions)} profiles={len(profiles)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
