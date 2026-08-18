#!/usr/bin/env python3
"""Validate control-plane-only ModelDeployment requests and catalog references."""

import argparse
import json
import pathlib
import sys

from jsonschema import Draft202012Validator
from ruamel.yaml import YAML


def load_yaml(path: pathlib.Path) -> dict:
    loader = YAML(typ="safe")
    with path.open(encoding="utf-8") as stream:
        document = loader.load(stream)
    if not isinstance(document, dict):
        raise ValueError("document must be one YAML object")
    return document


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests-dir", type=pathlib.Path, required=True)
    parser.add_argument("--catalog-dir", type=pathlib.Path, required=True)
    parser.add_argument("--schema", type=pathlib.Path, required=True)
    args = parser.parse_args()

    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errors: list[str] = []

    catalog_names: dict[str, set[str]] = {
        "ModelVersion": set(),
        "ModelRuntimeProfile": set(),
    }
    catalog_documents: dict[str, dict[str, dict]] = {
        "ModelVersion": {},
        "ModelRuntimeProfile": {},
    }
    for path in sorted(args.catalog_dir.glob("*.yaml")):
        try:
            document = load_yaml(path)
        except Exception as error:  # validated in more detail by validate-catalog.py
            errors.append(f"{path}: cannot read catalog reference: {error}")
            continue
        kind = document.get("kind")
        name = document.get("metadata", {}).get("name")
        if kind in catalog_names and isinstance(name, str):
            catalog_names[kind].add(name)
            catalog_documents[kind][name] = document

    requests = []
    if args.requests_dir.is_dir():
        requests = sorted(args.requests_dir.glob("*.yaml"))

    seen_names: set[str] = set()
    for path in requests:
        try:
            document = load_yaml(path)
        except Exception as error:
            errors.append(f"{path}: invalid YAML: {error}")
            continue

        for error in sorted(validator.iter_errors(document), key=lambda item: list(item.path)):
            location = ".".join(str(part) for part in error.path) or "<root>"
            errors.append(f"{path}:{location}: {error.message}")

        name = document.get("metadata", {}).get("name")
        if name != path.stem:
            errors.append(f"{path}: metadata.name must equal filename stem {path.stem!r}")
        if isinstance(name, str):
            if name in seen_names:
                errors.append(f"{path}: duplicate deployment name {name!r}")
            seen_names.add(name)

        spec = document.get("spec", {})
        model_ref = spec.get("modelVersionRef")
        runtime_ref = spec.get("runtimeProfileRef")
        if model_ref not in catalog_names["ModelVersion"]:
            errors.append(f"{path}: unknown ModelVersion {model_ref!r}")
        if runtime_ref not in catalog_names["ModelRuntimeProfile"]:
            errors.append(f"{path}: unknown ModelRuntimeProfile {runtime_ref!r}")

        if model_ref == "qwen3.8-27b-w8a8":
            validate_qwen38_release(
                path,
                document,
                catalog_documents["ModelVersion"].get(model_ref),
                catalog_documents["ModelRuntimeProfile"].get(runtime_ref),
                errors,
            )

    if errors:
        for message in errors:
            print(f"ERROR: {message}", file=sys.stderr)
        print("modeldeployment_validation=FAIL", file=sys.stderr)
        return 1

    print(f"modeldeployment_validation=PASS requests={len(requests)}")
    return 0


def validate_qwen38_release(
    path: pathlib.Path,
    deployment: dict,
    model_version: dict | None,
    runtime_profile: dict | None,
    errors: list[str],
) -> None:
    """Apply the bounded Ray/Artifact Keeper policy for the new release.

    The Kubernetes XRD keeps the same allow-list, while Tekton additionally
    checks that the small XR repeats the digests already recorded in the
    catalog. This prevents a user from changing a digest or storage boundary
    without changing the reviewed ModelVersion/RuntimeProfile.
    """

    prefix = f"{path}: qwen3.8 release"
    spec = deployment.get("spec", {})
    if spec.get("runtimeProfileRef") != "qwen38-w8a8-ray-ascend-910b3-v1":
        errors.append(f"{prefix}: runtimeProfileRef must be qwen38-w8a8-ray-ascend-910b3-v1")
    if spec.get("compositionRef", {}).get("name") != "modeldeployment-qwen38-ray-v1alpha1":
        errors.append(f"{prefix}: compositionRef must select the qwen38 Ray Composition")
    if spec.get("placement", {}).get("acceleratorPool") != "ascend-910b3":
        errors.append(f"{prefix}: placement.acceleratorPool must be ascend-910b3")
    selector = spec.get("placement", {}).get("nodeSelector", {})
    if selector != {
        "kubernetes.io/arch": "arm64",
        "kubernetes.io/hostname": "gpu-server-00",
        "node.kubernetes.io/npu.chip.name": "910B3",
    }:
        errors.append(f"{prefix}: nodeSelector must pin gpu-server-00/arm64/910B3")

    artifact = spec.get("artifact", {})
    runtime = spec.get("runtime", {})
    cache = spec.get("cache", {})
    for section_name, section in (("artifact", artifact), ("runtime", runtime), ("cache", cache)):
        if not isinstance(section, dict) or not section:
            errors.append(f"{prefix}: spec.{section_name} is required")

    if artifact.get("repository") != "model-artifacts":
        errors.append(f"{prefix}: artifact repository must be model-artifacts")
    if not str(artifact.get("path", "")).startswith("qwen3.8-27b/w8a8/"):
        errors.append(f"{prefix}: artifact.path must be under qwen3.8-27b/w8a8/")
    if not str(artifact.get("manifestDigest", "")).startswith("sha256:"):
        errors.append(f"{prefix}: artifact.manifestDigest must be immutable sha256")

    if model_version is None:
        errors.append(f"{prefix}: ModelVersion catalog entry is missing")
    else:
        model_spec = model_version.get("spec", {})
        source = model_spec.get("source", {})
        if source.get("type") != "modelscope":
            errors.append(f"{prefix}: ModelVersion source.type must be modelscope")
        if source.get("modelId") != model_spec.get("modelId"):
            errors.append(f"{prefix}: ModelScope modelId must match ModelVersion modelId")
        if source.get("revision") != model_spec.get("revision"):
            errors.append(f"{prefix}: ModelScope revision must match ModelVersion revision")
        if artifact.get("manifestDigest") != model_spec.get("artifact", {}).get("manifestDigest"):
            errors.append(f"{prefix}: XR manifestDigest differs from ModelVersion catalog")
        if artifact.get("path") != model_spec.get("artifact", {}).get("path"):
            errors.append(f"{prefix}: XR artifact.path differs from ModelVersion catalog")
        quantization = model_spec.get("quantization", {})
        if model_spec.get("format", {}).get("quantization") != "w8a8":
            errors.append(f"{prefix}: ModelVersion format.quantization must be w8a8")
        if quantization.get("tool") != "msmodelslim":
            errors.append(f"{prefix}: ModelVersion quantization.tool must be msmodelslim")
        if quantization.get("sourcePrecision") != "bf16":
            errors.append(f"{prefix}: ModelVersion quantization.sourcePrecision must be bf16")
        if quantization.get("target") != "w8a8":
            errors.append(f"{prefix}: ModelVersion quantization.target must be w8a8")
        if not str(quantization.get("inputArtifact", {}).get("path", "")).startswith("qwen3.8-27b/bf16/"):
            errors.append(f"{prefix}: quantization.inputArtifact.path must be under qwen3.8-27b/bf16/")

    if runtime.get("npuPerWorker") != 8:
        errors.append(f"{prefix}: runtime.npuPerWorker must be 8")
    if runtime.get("workerReplicas") not in {0, 1}:
        errors.append(f"{prefix}: runtime.workerReplicas must be 0 or 1")
    if spec.get("desiredState") == "Stopped" and runtime.get("workerReplicas") != 0:
        errors.append(f"{prefix}: Stopped releases must have workerReplicas=0")
    if spec.get("desiredState") == "Running" and runtime.get("workerReplicas") != 1:
        errors.append(f"{prefix}: Running releases must have workerReplicas=1")
    if not str(runtime.get("image", "")).startswith("110.120.0.3:30670/"):
        errors.append(f"{prefix}: runtime.image must come from Artifact Keeper")
    if not str(cache.get("image", "")).startswith("110.120.0.3:30670/"):
        errors.append(f"{prefix}: cache.image must come from Artifact Keeper")
    if cache.get("readerSecret") != "artifact-keeper-model-runtime":
        errors.append(f"{prefix}: cache.readerSecret must be the fixed read-only Secret reference")
    if cache.get("storageClassName", "").startswith("ora-desktop"):
        errors.append(f"{prefix}: ora-desktop cache storage is forbidden")

    if runtime_profile is None:
        errors.append(f"{prefix}: ModelRuntimeProfile catalog entry is missing")
    else:
        profile_spec = runtime_profile.get("spec", {})
        profile_runtime = profile_spec.get("runtime", {})
        if profile_spec.get("workload", {}).get("kind") != "RayService":
            errors.append(f"{prefix}: runtime profile workload.kind must be RayService")
        if runtime.get("image") != profile_runtime.get("image"):
            errors.append(f"{prefix}: XR runtime.image differs from RuntimeProfile catalog")
        if runtime.get("modelPath") != profile_runtime.get("modelPath"):
            errors.append(f"{prefix}: XR runtime.modelPath differs from RuntimeProfile catalog")
        if runtime.get("modelName") != profile_runtime.get("modelName"):
            errors.append(f"{prefix}: XR runtime.modelName differs from RuntimeProfile catalog")


if __name__ == "__main__":
    raise SystemExit(main())
