#!/usr/bin/env python3
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from modelscope_import import (
    build_manifest,
    canonical_manifest,
    manifest_digest,
    validate_relative_path,
)


class ManifestTests(unittest.TestCase):
    def test_manifest_is_sorted_and_reproducible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "z").write_text("last\n", encoding="utf-8")
            (root / "a").write_bytes(b"first")
            (root / ".cache").mkdir()
            (root / ".cache" / "state").write_text("ignored", encoding="utf-8")

            manifest = build_manifest(root)

        self.assertEqual([entry["path"] for entry in manifest["files"]], ["a", "z"])
        expected = "sha256:" + hashlib.sha256(canonical_manifest(manifest)).hexdigest()
        self.assertEqual(manifest_digest(manifest), expected)
        self.assertEqual(json.loads(canonical_manifest(manifest)), {
            "schemaVersion": 1,
            "files": manifest["files"],
        })

    def test_path_traversal_is_rejected(self) -> None:
        with self.assertRaises(RuntimeError):
            validate_relative_path("../outside")
        with self.assertRaises(RuntimeError):
            validate_relative_path("/absolute")


if __name__ == "__main__":
    unittest.main()
