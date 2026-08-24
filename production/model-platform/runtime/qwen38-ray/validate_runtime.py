#!/usr/bin/env python3
"""Release gates for the Qwen3.8 Ray Serve LLM runtime."""

from __future__ import annotations

import argparse
import importlib.metadata
import platform
import shutil


EXPECTED = {
    "google-api-core": "2.25.2",
    "googleapis-common-protos": "1.70.0",
    "proto-plus": "1.26.1",
    "protobuf": "5.29.6",
    "ray": "2.48.0",
    "pyarrow": "20.0.0",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("build", "runtime"),
        default="runtime",
        help="build avoids loading the Ascend plugin; runtime requires the driver libraries",
    )
    args = parser.parse_args()

    assert platform.machine() in {"aarch64", "arm64"}, platform.machine()
    assert platform.python_version() == "3.12.13", platform.python_version()

    versions = {name: importlib.metadata.version(name) for name in EXPECTED}
    for name, expected in EXPECTED.items():
        assert versions[name] == expected, (name, versions[name], expected)

    vllm_version = importlib.metadata.version("vllm")
    assert vllm_version.startswith("0.23.0"), vllm_version

    import pyarrow  # noqa: F401
    import ray  # noqa: F401
    import ray.serve  # noqa: F401

    # These are the Ray LLM-extra modules absent from the vendor base image.
    for module in (
        "aiohttp_cors",
        "colorful",
        "jsonref",
        "opencensus",
        "opentelemetry.exporter.prometheus",
        "smart_open",
        "virtualenv",
    ):
        __import__(module)
    assert shutil.which("py-spy"), "py-spy executable is missing"

    if args.mode == "runtime":
        # Importing this activates vLLM-Ascend and therefore requires the
        # host driver libraries to be mounted into the validation container.
        from ray.serve.llm import build_openai_app  # noqa: F401

    print(
        f"qwen38_ray_runtime_{args.mode}=PASS "
        f"python={platform.python_version()} "
        f"ray={versions['ray']} protobuf={versions['protobuf']} "
        f"pyarrow={versions['pyarrow']} "
        f"vllm={vllm_version}"
    )


if __name__ == "__main__":
    main()
