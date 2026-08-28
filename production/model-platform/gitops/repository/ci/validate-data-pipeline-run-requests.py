#!/usr/bin/env python3
"""Validate Git-only CPU staging requests before a later dispatcher sees them."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml
from jsonschema import Draft202012Validator


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--requests-dir', required=True)
    parser.add_argument('--schema', required=True)
    args = parser.parse_args()

    requests_dir = Path(args.requests_dir)
    if not requests_dir.exists():
        print('data_pipeline_requests=NONE')
        return 0
    if not requests_dir.is_dir():
        raise SystemExit('requests-dir is not a directory')

    schema = json.loads(Path(args.schema).read_text(encoding='utf-8'))
    validator = Draft202012Validator(schema)
    files = sorted((*requests_dir.glob('*.yaml'), *requests_dir.glob('*.yml')))
    names: set[str] = set()
    for path in files:
        document = yaml.safe_load(path.read_text(encoding='utf-8'))
        errors = sorted(validator.iter_errors(document), key=lambda error: list(error.absolute_path))
        if errors:
            raise SystemExit(f'{path}: {errors[0].message}')
        name = document['metadata']['name']
        if name in names:
            raise SystemExit(f'duplicate DataPipelineRunRequest name: {name}')
        names.add(name)
    print(f'data_pipeline_requests=PASS count={len(files)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
