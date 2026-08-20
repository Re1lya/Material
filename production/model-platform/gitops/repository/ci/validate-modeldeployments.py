#!/usr/bin/env python3
"""Validate control-plane-only ModelDeployment requests and catalog references."""

import argparse
import json
import pathlib
import sys

from jsonschema import Draft202012Validator
from ruamel.yaml import YAML


QWEN38_RUNTIME_PROFILES = {
    "qwen38-w8a8-ray-ascend-910b3-v1": 8,
    "qwen38-w8a8-ray-ascend-910b3-tp2-v1": 2,
}


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
    runtime_ref = spec.get("runtimeProfileRef")
    if runtime_ref not in QWEN38_RUNTIME_PROFILES:
        errors.append(
            f"{prefix}: runtimeProfileRef must be one of "
            f"{', '.join(sorted(QWEN38_RUNTIME_PROFILES))}"
        )
    composition = spec.get("compositionRef", {}).get("name")
    crossplane_composition = (
        spec.get("crossplane", {}).get("compositionRef", {}).get("name")
    )
    if crossplane_composition != composition:
        errors.append(
            f"{prefix}: crossplane.compositionRef.name must match compositionRef.name"
        )
    control_plane_only = composition == "modeldeployment-control-plane-v1alpha1"
    if composition not in {
        "modeldeployment-control-plane-v1alpha1",
        "modeldeployment-qwen38-ray-v1alpha1",
    }:
        errors.append(
            f"{prefix}: compositionRef must select control-plane or qwen38 Ray Composition"
        )
    placement = spec.get("placement", {})
    if control_plane_only:
        if spec.get("desiredState") != "Stopped":
            errors.append(f"{prefix}: control-plane composition requires desiredState=Stopped")
        if placement.get("acceleratorPool") != "control-plane-only":
            errors.append(
                f"{prefix}: control-plane composition requires placement.acceleratorPool=control-plane-only"
            )
        if placement.get("nodeSelector"):
            errors.append(f"{prefix}: control-plane composition must not select a physical node")
    else:
        if placement.get("acceleratorPool") != "ascend-a3":
            errors.append(f"{prefix}: placement.acceleratorPool must be ascend-a3")
        selector = placement.get("nodeSelector", {})
        if selector != {
            "kubernetes.io/arch": "arm64",
            "kubernetes.io/hostname": "a3-server-00",
            "node.kubernetes.io/npu.chip.name": "Ascend910",
        }:
            errors.append(f"{prefix}: nodeSelector must pin a3-server-00/arm64/Ascend910")

        allocation = placement.get("staticDeviceAllocation", "")
        devices = allocation.split(",") if allocation else []
        if len(devices) != len(set(devices)):
            errors.append(f"{prefix}: staticDeviceAllocation must not contain duplicate devices")
        if runtime_ref == "qwen38-w8a8-ray-ascend-910b3-tp2-v1" and devices != [
            "Ascend910-8",
            "Ascend910-9",
        ]:
            errors.append(
                f"{prefix}: A3 TP2 release must be isolated to Ascend910-8,Ascend910-9"
            )

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
        source_type = source.get("type")
        if source_type not in {"modelscope", "a3-preloaded"}:
            errors.append(
                f"{prefix}: ModelVersion source.type must be modelscope or a3-preloaded"
            )
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
        if source_type == "modelscope":
            if not quantization.get("calibrationDatasetDigest"):
                errors.append(f"{prefix}: ModelScope quantization requires calibrationDatasetDigest")
            if not str(quantization.get("inputArtifact", {}).get("path", "")).startswith("qwen3.8-27b/bf16/"):
                errors.append(
                    f"{prefix}: ModelScope quantization.inputArtifact.path must be under qwen3.8-27b/bf16/"
                )

    expected_npu = QWEN38_RUNTIME_PROFILES.get(runtime_ref)
    if expected_npu is not None and runtime.get("npuPerWorker") != expected_npu:
        errors.append(
            f"{prefix}: runtime.npuPerWorker must be {expected_npu} for {runtime_ref}"
        )
    if runtime.get("workerReplicas") not in {0, 1}:
        errors.append(f"{prefix}: runtime.workerReplicas must be 0 or 1")
    if runtime_ref == "qwen38-w8a8-ray-ascend-910b3-tp2-v1" and runtime.get("workerCPU") != "48":
        errors.append(f"{prefix}: A3 TP2 runtime.workerCPU must be 48 to preserve node headroom")
    if spec.get("desiredState") == "Stopped" and runtime.get("workerReplicas") != 0:
        errors.append(f"{prefix}: Stopped releases must have workerReplicas=0")
    if spec.get("desiredState") == "Running" and runtime.get("workerReplicas") != 1:
        errors.append(f"{prefix}: Running releases must have workerReplicas=1")
    annotations = deployment.get("metadata", {}).get("annotations", {})
    if spec.get("desiredState") == "Stopped":
        expected_effective = ("declarative-stopped", "0", "0", "0")
    else:
        expected_effective = (
            "declarative-running",
            str(expected_npu),
            "1",
            str(expected_npu),
        )
    actual_effective = (
        annotations.get("platform.example.com/request-mode"),
        annotations.get("platform.example.com/effective-tensor-parallel-size"),
        annotations.get("platform.example.com/effective-replicas"),
        annotations.get("platform.example.com/effective-npu-per-replica"),
    )
    if actual_effective != expected_effective:
        errors.append(
            f"{prefix}: effective annotations must match desiredState/runtime resources"
        )
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
        if runtime.get("serveConfigV2") != profile_runtime.get("serveConfigV2"):
            errors.append(f"{prefix}: XR runtime.serveConfigV2 differs from RuntimeProfile catalog")
        expected_npu = QWEN38_RUNTIME_PROFILES.get(runtime_ref)
        if expected_npu is not None:
            profile_resources = profile_spec.get("resources", {})
            for resource_type in ("requests", "limits"):
                resource_value = profile_resources.get(resource_type, {}).get(
                    "huawei.com/Ascend910"
                )
                if str(resource_value) != str(expected_npu):
                    errors.append(
                        f"{prefix}: RuntimeProfile resources.{resource_type}."
                        f"huawei.com/Ascend910 must be {expected_npu}"
                    )
            if runtime_ref == "qwen38-w8a8-ray-ascend-910b3-tp2-v1":
                for resource_type in ("requests", "limits"):
                    if profile_resources.get(resource_type, {}).get("cpu") != "48":
                        errors.append(
                            f"{prefix}: RuntimeProfile resources.{resource_type}.cpu must be 48"
                        )
        if runtime_ref == "qwen38-w8a8-ray-ascend-910b3-tp2-v1":
            validate_qwen38_tp2_serve_config(
                prefix,
                runtime.get("serveConfigV2"),
                runtime.get("modelPath"),
                errors,
            )


def validate_qwen38_tp2_serve_config(
    prefix: str,
    serve_config: object,
    model_path: object,
    errors: list[str],
) -> None:
    """Validate the Ray Serve LLM contract that replaces the Docker flags."""

    if not isinstance(serve_config, str):
        errors.append(f"{prefix}: TP2 serveConfigV2 must be a YAML string")
        return
    try:
        config = YAML(typ="safe").load(serve_config)
    except Exception as error:
        errors.append(f"{prefix}: TP2 serveConfigV2 is invalid YAML: {error}")
        return
    applications = config.get("applications") if isinstance(config, dict) else None
    application = applications[0] if isinstance(applications, list) and applications else None
    llm_configs = application.get("args", {}).get("llm_configs") if isinstance(application, dict) else None
    llm_config = llm_configs[0] if isinstance(llm_configs, list) and llm_configs else None
    if not isinstance(application, dict) or not isinstance(llm_config, dict):
        errors.append(f"{prefix}: TP2 serveConfigV2 must define one Ray Serve LLM config")
        return

    if application.get("import_path") != "ray.serve.llm:build_openai_app":
        errors.append(f"{prefix}: TP2 serveConfigV2 must use ray.serve.llm:build_openai_app")
    if llm_config.get("model_loading_config", {}).get("model_source") != model_path:
        errors.append(f"{prefix}: TP2 model_source must match runtime.modelPath")

    deployment = llm_config.get("deployment_config", {})
    if deployment.get("num_replicas") != 1 or deployment.get("max_ongoing_requests") != 64:
        errors.append(f"{prefix}: TP2 Ray Serve deployment must be 1 replica with 64 max ongoing requests")

    if "placement_group_config" in llm_config:
        errors.append(f"{prefix}: Ray 2.48 LLMConfig does not accept placement_group_config")
    if llm_config.get("resources_per_bundle") != {"NPU": 1, "GPU": 1}:
        errors.append(f"{prefix}: TP2 resources_per_bundle must expose one NPU and one Ray GPU alias")

    engine = llm_config.get("engine_kwargs", {})
    expected_engine = {
        "tensor_parallel_size": 2,
        "data_parallel_size": 1,
        "pipeline_parallel_size": 1,
        "distributed_executor_backend": "ray",
        "quantization": "ascend",
        "max_model_len": 32768,
        "max_num_seqs": 64,
        "max_num_batched_tokens": 8192,
        "gpu_memory_utilization": 0.9,
        "enable_prefix_caching": True,
        "trust_remote_code": True,
        "speculative_config": {
            "method": "qwen3_5_mtp",
            "num_speculative_tokens": 3,
            "enforce_eager": True,
        },
        "compilation_config": {"cudagraph_mode": "FULL_DECODE_ONLY"},
    }
    for key, expected in expected_engine.items():
        if engine.get(key) != expected:
            errors.append(f"{prefix}: TP2 engine_kwargs.{key} must equal {expected!r}")


if __name__ == "__main__":
    raise SystemExit(main())
