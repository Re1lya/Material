#!/usr/bin/env python3
import base64
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock
import urllib.request

import yaml


PIPELINE = Path(__file__).with_name("pipeline.yaml")
RECLAIMER_RBAC = Path(__file__).with_name("model-cache-reclaimer-rbac.yaml")
REVISION = "a" * 40
BASE_SHA = "b" * 40


class CompatibleYAML:
    def __init__(self, typ=None):
        self.typ = typ

    def load(self, value):
        return yaml.safe_load(value)


class FakeResponse:
    def __init__(self, value, status=200):
        self.status = status
        self.payload = json.dumps(value).encode()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return self.payload


def pipeline_document():
    return yaml.safe_load(PIPELINE.read_text())


def task_script(name):
    task = next(
        item for item in pipeline_document()["spec"]["tasks"] if item["name"] == name
    )
    return task["taskSpec"]["steps"][0]["script"]


def running_document():
    return {
        "apiVersion": "platform.example.com/v1alpha1",
        "kind": "ModelDeployment",
        "metadata": {
            "name": "qwen38-27b",
            "namespace": "model-serving",
            "labels": {"platform.example.com/requested-by": "gitadmin"},
            "annotations": {
                "platform.example.com/request-mode": "declarative-running",
                "platform.example.com/effective-tensor-parallel-size": "2",
                "platform.example.com/effective-replicas": "1",
                "platform.example.com/effective-npu-per-replica": "2",
                "platform.example.com/requested-start-id": "start-policy-test",
                "platform.example.com/requested-start-reason": "policy test",
            },
        },
        "spec": {
            "desiredState": "Running",
            "runtimeProfileRef": "qwen38-w8a8-ray-ascend-910b3-tp2-v1",
            "compositionRef": {"name": "modeldeployment-qwen38-ray-v2"},
            "crossplane": {
                "compositionRef": {
                    "name": "modeldeployment-qwen38-ray-v2"
                },
                "compositionUpdatePolicy": "Automatic",
            },
            "runtime": {
                "image": "registry.example/qwen@sha256:certified",
                "npuPerWorker": 2,
                "workerReplicas": 1,
                "serving": {
                    "tensorParallelSize": 2,
                    "requestedReplicas": 1,
                },
            },
            "placement": {"acceleratorPool": "ascend-a3"},
        },
    }


def stopped_document(base):
    result = copy.deepcopy(base)
    result["metadata"]["annotations"].update(
        {
            "platform.example.com/request-mode": "declarative-stopped",
            "platform.example.com/effective-tensor-parallel-size": "0",
            "platform.example.com/effective-replicas": "0",
            "platform.example.com/effective-npu-per-replica": "0",
        }
    )
    result["metadata"]["annotations"].pop(
        "platform.example.com/requested-start-id"
    )
    result["metadata"]["annotations"].pop(
        "platform.example.com/requested-start-reason"
    )
    result["spec"]["desiredState"] = "Stopped"
    result["spec"]["runtime"]["workerReplicas"] = 0
    result["spec"]["compositionRef"] = {
        "name": "modeldeployment-stopped-v2"
    }
    result["spec"]["crossplane"]["compositionRef"] = {
        "name": "modeldeployment-stopped-v2"
    }
    return result


class StopAutoMergePolicyTest(unittest.TestCase):
    def execute_policy(self, head):
        base = running_document()
        merge_requests = []

        def encoded(document):
            return base64.b64encode(yaml.safe_dump(document).encode()).decode()

        pull = {
            "state": "open",
            "number": 7,
            "base": {"ref": "main", "sha": BASE_SHA},
            "head": {
                "ref": "backstage/modeldeployment-stopping-qwen38-27b",
                "sha": REVISION,
                "repo": {"full_name": "gitadmin/model-platform-config"},
            },
        }

        def fake_urlopen(request, timeout=30):
            del timeout
            url = request.full_url
            method = request.get_method()
            if url.endswith("/pulls/7") and method == "GET":
                return FakeResponse(pull)
            if url.endswith("/pulls/7/files") and method == "GET":
                return FakeResponse(
                    [
                        {
                            "filename": "environments/production/modeldeployments/qwen38-27b.yaml",
                            "status": "changed",
                        }
                    ]
                )
            if f"ref={BASE_SHA}" in url and method == "GET":
                return FakeResponse({"content": encoded(base)})
            if f"ref={REVISION}" in url and method == "GET":
                return FakeResponse({"content": encoded(head)})
            if url.endswith("/pulls/7/merge") and method == "POST":
                merge_requests.append(json.loads(request.data))
                return FakeResponse({"merged": True})
            raise AssertionError(f"unexpected request: {method} {url}")

        with tempfile.TemporaryDirectory() as policy_dir:
            policy_path = Path(policy_dir)
            values = {
                "allowlisted-requested-by": "gitadmin",
                "expected-npu-per-worker": "2",
                "expected-tensor-parallel-size": "2",
                "expected-composition-ref": "modeldeployment-qwen38-ray-v2",
                "expected-stopped-composition-ref": "modeldeployment-stopped-v2",
            }
            for name, value in values.items():
                (policy_path / name).write_text(value)

            script = task_script("auto-merge-stop-request").replace(
                'POLICY_DIR = "/var/run/running-gate-policy"',
                f"POLICY_DIR = {str(policy_path)!r}",
            )
            ruamel_module = types.ModuleType("ruamel")
            ruamel_yaml_module = types.ModuleType("ruamel.yaml")
            ruamel_yaml_module.YAML = CompatibleYAML
            ruamel_module.yaml = ruamel_yaml_module
            environment = {
                "REVISION": REVISION,
                "PULL_REQUEST_NUMBER": "7",
                "PULL_REQUEST_HEAD_REF": "backstage/modeldeployment-stopping-qwen38-27b",
                "GITEA_MERGE_TOKEN": "test-token-with-sufficient-length",
            }
            with mock.patch.dict(
                sys.modules,
                {"ruamel": ruamel_module, "ruamel.yaml": ruamel_yaml_module},
            ), mock.patch.dict(os.environ, environment), mock.patch.object(
                urllib.request, "urlopen", fake_urlopen
            ):
                exec(compile(script, "auto-merge-stop-request", "exec"), {})
        return merge_requests

    def test_accepts_only_the_lifecycle_stop_projection(self):
        merge_requests = self.execute_policy(stopped_document(running_document()))
        self.assertEqual(len(merge_requests), 1)
        self.assertEqual(merge_requests[0]["head_commit_id"], REVISION)
        self.assertFalse(merge_requests[0]["force_merge"])

    def test_zero_resource_stop_switches_to_stopped_composition(self):
        head = stopped_document(running_document())
        self.assertEqual(
            head["spec"]["compositionRef"]["name"],
            "modeldeployment-stopped-v2",
        )
        self.assertEqual(
            head["spec"]["crossplane"]["compositionRef"]["name"],
            "modeldeployment-stopped-v2",
        )
        self.assertEqual(len(self.execute_policy(head)), 1)

    def test_rejects_an_unrelated_runtime_change(self):
        head = stopped_document(running_document())
        head["spec"]["runtime"]["image"] = "registry.example/changed@sha256:bad"
        with self.assertRaisesRegex(
            SystemExit, "diff contains changes outside desiredState"
        ):
            self.execute_policy(head)

    def test_pipeline_routes_stop_and_start_requests_to_separate_tasks(self):
        stopped_script = task_script("auto-merge-stopped-request")
        running_script = task_script("auto-merge-running-request")
        self.assertIn("auto-merge-stop-request", stopped_script)
        self.assertIn("modeldeployment-stopping-", running_script)
        self.assertIn("open stop request takes priority", running_script)
        self.assertIn("expected-stopped-composition-ref", running_script)

    def test_capacity_gate_does_not_require_removed_cache_job(self):
        capacity_script = task_script("capacity-gate-running")
        self.assertNotIn(
            "/apis/batch/v1/namespaces/model-serving/jobs/", capacity_script
        )
        self.assertIn("expected-stopped-composition-ref", capacity_script)
        self.assertIn("expected-cache-revision", capacity_script)

    def test_running_merge_waits_for_exact_pv_reclaimer(self):
        document = pipeline_document()
        tasks = {item["name"]: item for item in document["spec"]["tasks"]}
        self.assertEqual(
            tasks["auto-merge-running-request"]["runAfter"],
            ["reclaim-retained-cache-pv"],
        )
        script = task_script("reclaim-retained-cache-pv")
        self.assertIn("model-cache-a3-qwen38-27b-w8a8", script)
        self.assertIn('"op": "remove", "path": "/spec/claimRef"', script)

    def test_reclaimer_rbac_can_patch_only_the_certified_pv(self):
        documents = list(yaml.safe_load_all(RECLAIMER_RBAC.read_text()))
        role = next(item for item in documents if item["kind"] == "ClusterRole")
        self.assertEqual(
            role["rules"],
            [
                {
                    "apiGroups": [""],
                    "resources": ["persistentvolumes"],
                    "resourceNames": ["model-cache-a3-qwen38-27b-w8a8"],
                    "verbs": ["get", "patch"],
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
