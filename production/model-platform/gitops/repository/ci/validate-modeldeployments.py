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

    if errors:
        for message in errors:
            print(f"ERROR: {message}", file=sys.stderr)
        print("modeldeployment_validation=FAIL", file=sys.stderr)
        return 1

    print(f"modeldeployment_validation=PASS requests={len(requests)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
