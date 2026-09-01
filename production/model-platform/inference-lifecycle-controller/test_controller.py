#!/usr/bin/env python3
import copy
import unittest
from unittest import mock
import urllib.error

from controller import (
    Decision,
    KubernetesClient,
    LifecycleController,
    RECONCILED_ANNOTATION,
    evaluate,
)


def modeldeployment(state="Stopped", workers=0):
    return {
        "metadata": {
            "name": "qwen38-27b",
            "generation": 12,
            "annotations": {
                "platform.example.com/lifecycle-controller": "enabled"
            },
        },
        "spec": {
            "desiredState": state,
            "compositionRef": {
                "name": "modeldeployment-qwen38-ray-v1alpha1"
            },
            "runtime": {"workerReplicas": workers},
        },
        "status": {
            "conditions": [
                {"type": "Synced", "status": "True"},
                {"type": "Ready", "status": "True"},
            ]
        },
    }


def rayservice(workers=0, marker=None):
    annotations = {}
    if marker:
        annotations[RECONCILED_ANNOTATION] = marker
    return {
        "metadata": {
            "name": "qwen38-27b",
            "uid": "rayservice-uid",
            "generation": 7,
            "labels": {
                "app.kubernetes.io/part-of": "model-platform",
                "platform.example.com/deployment": "qwen38-27b",
            },
            "annotations": annotations,
        },
        "spec": {
            "rayClusterConfig": {
                "workerGroupSpecs": [
                    {
                        "groupName": "worker",
                        "replicas": workers,
                        "minReplicas": workers,
                        "maxReplicas": 1,
                    }
                ]
            }
        },
    }


def raycluster(workers=0, owner_uid="rayservice-uid"):
    return {
        "metadata": {
            "name": "qwen38-27b-abcde",
            "uid": "raycluster-uid",
            "labels": {
                "app.kubernetes.io/part-of": "model-platform",
                "platform.example.com/deployment": "qwen38-27b",
            },
            "ownerReferences": [
                {
                    "apiVersion": "ray.io/v1",
                    "kind": "RayService",
                    "name": "qwen38-27b",
                    "uid": owner_uid,
                    "controller": True,
                }
            ],
        },
        "spec": {
            "workerGroupSpecs": [
                {
                    "groupName": "worker",
                    "replicas": workers,
                    "minReplicas": workers,
                    "maxReplicas": 1,
                }
            ]
        },
    }


class FakeController(LifecycleController):
    def __init__(self, deployment, service, clusters):
        super().__init__(None, "model-serving", ["qwen38-27b"], 30)
        self.deployment = deployment
        self.service = service
        self.cluster_items = clusters
        self.deleted = []
        self.markers = []

    def get(self, plural, name, group, version):
        del name, group, version
        if plural == "modeldeployments":
            return self.deployment
        if plural == "rayservices":
            return self.service
        raise AssertionError(plural)

    def clusters(self, deployment):
        del deployment
        return self.cluster_items

    def delete_cluster(self, decision):
        self.deleted.append((decision.raycluster_name, decision.raycluster_uid))

    def mark_reconciled(self, rayservice_name, reconciliation_key):
        self.markers.append((rayservice_name, reconciliation_key))


class RecordingClient:
    def __init__(self):
        self.calls = []

    def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        return {}


class LifecycleDecisionTest(unittest.TestCase):
    def test_matching_stopped_cluster_is_healthy(self):
        decision = evaluate(
            modeldeployment(), rayservice(), [raycluster()]
        )
        self.assertEqual(decision.state, "healthy")

    def test_running_transition_detects_stale_head_only_cluster(self):
        decision = evaluate(
            modeldeployment("Running", 1), rayservice(1), [raycluster(0)]
        )
        self.assertEqual(decision.state, "mismatch")
        self.assertEqual(decision.expected_workers, 1)
        self.assertEqual(decision.raycluster_uid, "raycluster-uid")

    def test_waits_until_rayservice_spec_matches_modeldeployment(self):
        decision = evaluate(
            modeldeployment("Running", 1), rayservice(0), [raycluster(0)]
        )
        self.assertEqual(decision.state, "waiting")

    def test_wrong_owner_reference_is_never_deleted(self):
        decision = evaluate(
            modeldeployment("Running", 1),
            rayservice(1),
            [raycluster(0, owner_uid="someone-else")],
        )
        self.assertEqual(decision.state, "waiting")
        self.assertIsNone(decision.raycluster_uid)

    def test_persistent_marker_blocks_repeat_deletion(self):
        key = "deployment-12:rayservice-7:workers-1"
        decision = evaluate(
            modeldeployment("Running", 1),
            rayservice(1, marker=key),
            [raycluster(0)],
        )
        self.assertEqual(decision.state, "blocked")
        self.assertIn("already reconciled", decision.reason)

    def test_reconciler_waits_for_grace_then_deletes_with_identity(self):
        controller = FakeController(
            modeldeployment("Running", 1), rayservice(1), [raycluster(0)]
        )
        controller.reconcile("qwen38-27b", now=100)
        controller.reconcile("qwen38-27b", now=129)
        self.assertEqual(controller.deleted, [])
        controller.reconcile("qwen38-27b", now=130)
        self.assertEqual(
            controller.deleted, [("qwen38-27b-abcde", "raycluster-uid")]
        )
        self.assertEqual(len(controller.markers), 1)
        controller.reconcile("qwen38-27b", now=200)
        self.assertEqual(len(controller.deleted), 1)

    def test_unrelated_mutations_do_not_change_evaluation_inputs(self):
        cluster = raycluster(0)
        original = copy.deepcopy(cluster)
        evaluate(modeldeployment("Running", 1), rayservice(1), [cluster])
        self.assertEqual(cluster, original)

    def test_delete_uses_uid_precondition_and_marker_uses_merge_patch(self):
        client = RecordingClient()
        controller = LifecycleController(
            client, "model-serving", ["qwen38-27b"], 30
        )
        decision = Decision(
            "mismatch",
            "stale",
            expected_workers=1,
            raycluster_name="qwen38-27b-abcde",
            raycluster_uid="raycluster-uid",
            reconciliation_key="generation-key",
        )
        controller.delete_cluster(decision)
        controller.mark_reconciled("qwen38-27b", "generation-key")
        delete_call, patch_call = client.calls
        self.assertEqual(
            delete_call[2]["body"]["preconditions"]["uid"], "raycluster-uid"
        )
        self.assertEqual(
            patch_call[2]["content_type"], "application/merge-patch+json"
        )

    def test_kubernetes_client_treats_an_accepted_404_as_missing(self):
        client = object.__new__(KubernetesClient)
        client.base = "https://kubernetes.example"
        client.token = "test-token"
        client.context = None
        error = urllib.error.HTTPError(
            "https://kubernetes.example/missing", 404, "Not Found", {}, None
        )
        with mock.patch("urllib.request.urlopen", side_effect=error):
            self.assertIsNone(client.request("GET", "/missing", accepted=(200, 404)))


if __name__ == "__main__":
    unittest.main()
