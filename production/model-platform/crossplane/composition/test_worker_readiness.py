#!/usr/bin/env python3
from pathlib import Path
import unittest

import yaml


COMPOSITIONS = (
    Path(__file__).with_name("modeldeployment-qwen38-ray.yaml"),
    Path(__file__).with_name("modeldeployment-qwen38-ray-v2.yaml"),
)


class WorkerReadinessContractTest(unittest.TestCase):
    def test_worker_checks_raylet_without_requiring_head_serve_http(self):
        for composition in COMPOSITIONS:
            with self.subTest(composition=composition.name):
                document = yaml.safe_load(composition.read_text())
                resources = document["spec"]["pipeline"][0]["input"]["resources"]
                rayservice = next(item for item in resources if item["name"] == "rayservice")
                manifest = rayservice["base"]["spec"]["forProvider"]["manifest"]
                worker = manifest["spec"]["rayClusterConfig"]["workerGroupSpecs"][0][
                    "template"
                ]["spec"]["containers"][0]
                command = " ".join(worker["readinessProbe"]["exec"]["command"])
                self.assertIn("localhost:52365/api/local_raylet_healthz", command)
                self.assertNotIn("localhost:8000", command)
                self.assertEqual(worker["readinessProbe"]["failureThreshold"], 12)


if __name__ == "__main__":
    unittest.main()
