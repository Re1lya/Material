#!/usr/bin/env python3
"""Recreate stale KubeRay RayClusters after ModelDeployment lifecycle changes."""

from dataclasses import dataclass
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


CERTIFIED_COMPOSITION = "modeldeployment-qwen38-ray-v1alpha1"
DEPLOYMENT_LABEL = "platform.example.com/deployment"
PART_OF_LABEL = "app.kubernetes.io/part-of"
RECONCILED_ANNOTATION = "platform.example.com/lifecycle-reconciled-key"


def log(level, message, **fields):
    record = {
        "level": level,
        "message": message,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **fields,
    }
    print(json.dumps(record, sort_keys=True), flush=True)


def condition_true(resource, condition_type):
    return any(
        condition.get("type") == condition_type
        and condition.get("status") == "True"
        for condition in resource.get("status", {}).get("conditions", [])
    )


def worker_contract(resource, path):
    current = resource
    for part in path:
        current = current.get(part, {})
    groups = current.get("workerGroupSpecs", [])
    workers = [group for group in groups if group.get("groupName") == "worker"]
    if len(workers) != 1:
        return None
    worker = workers[0]
    return (
        worker.get("replicas"),
        worker.get("minReplicas"),
        worker.get("maxReplicas"),
    )


def controller_owner(resource, rayservice):
    expected_uid = rayservice.get("metadata", {}).get("uid")
    expected_name = rayservice.get("metadata", {}).get("name")
    return any(
        owner.get("controller") is True
        and owner.get("apiVersion") == "ray.io/v1"
        and owner.get("kind") == "RayService"
        and owner.get("name") == expected_name
        and owner.get("uid") == expected_uid
        for owner in resource.get("metadata", {}).get("ownerReferences", [])
    )


@dataclass(frozen=True)
class Decision:
    state: str
    reason: str
    expected_workers: int | None = None
    raycluster_name: str | None = None
    raycluster_uid: str | None = None
    reconciliation_key: str | None = None


def evaluate(deployment, rayservice, rayclusters):
    deployment_name = deployment.get("metadata", {}).get("name")
    annotations = deployment.get("metadata", {}).get("annotations", {})
    if annotations.get("platform.example.com/lifecycle-controller") != "enabled":
        return Decision("ignored", "deployment is not opted into lifecycle control")
    if not condition_true(deployment, "Synced") or not condition_true(
        deployment, "Ready"
    ):
        return Decision("waiting", "ModelDeployment is not Synced and Ready")

    spec = deployment.get("spec", {})
    if spec.get("compositionRef", {}).get("name") != CERTIFIED_COMPOSITION:
        return Decision("blocked", "deployment composition is not certified")
    desired_state = spec.get("desiredState")
    if desired_state == "Running":
        expected_workers = 1
    elif desired_state == "Stopped":
        expected_workers = 0
    else:
        return Decision("blocked", "deployment desiredState is unsupported")
    if spec.get("runtime", {}).get("workerReplicas") != expected_workers:
        return Decision("waiting", "ModelDeployment runtime does not match desiredState")

    rs_metadata = rayservice.get("metadata", {})
    rs_labels = rs_metadata.get("labels", {})
    if rs_metadata.get("name") != deployment_name:
        return Decision("blocked", "RayService name does not match deployment")
    if rs_labels.get(DEPLOYMENT_LABEL) != deployment_name:
        return Decision("blocked", "RayService deployment label does not match")
    if rs_labels.get(PART_OF_LABEL) != "model-platform":
        return Decision("blocked", "RayService is outside the model platform boundary")

    expected_contract = (expected_workers, expected_workers, 1)
    rayservice_contract = worker_contract(rayservice, ("spec", "rayClusterConfig"))
    if rayservice_contract != expected_contract:
        return Decision(
            "waiting",
            "RayService worker contract has not reached the desired lifecycle state",
            expected_workers=expected_workers,
        )

    owned = []
    for cluster in rayclusters:
        metadata = cluster.get("metadata", {})
        labels = metadata.get("labels", {})
        if labels.get(DEPLOYMENT_LABEL) != deployment_name:
            continue
        if labels.get(PART_OF_LABEL) != "model-platform":
            continue
        if controller_owner(cluster, rayservice):
            owned.append(cluster)
    if not owned:
        return Decision(
            "waiting",
            "no controller-owned RayCluster exists yet",
            expected_workers=expected_workers,
        )
    if len(owned) != 1:
        return Decision(
            "blocked",
            "expected exactly one controller-owned RayCluster",
            expected_workers=expected_workers,
        )

    cluster = owned[0]
    cluster_contract = worker_contract(cluster, ("spec",))
    if cluster_contract == expected_contract:
        return Decision(
            "healthy",
            "RayCluster worker contract matches the desired lifecycle state",
            expected_workers=expected_workers,
        )

    deployment_generation = deployment.get("metadata", {}).get("generation")
    rayservice_generation = rs_metadata.get("generation")
    if not isinstance(deployment_generation, int) or not isinstance(
        rayservice_generation, int
    ):
        return Decision("blocked", "resource generation is missing")
    reconciliation_key = (
        f"deployment-{deployment_generation}:rayservice-{rayservice_generation}:"
        f"workers-{expected_workers}"
    )
    if rs_metadata.get("annotations", {}).get(RECONCILED_ANNOTATION) == reconciliation_key:
        return Decision(
            "blocked",
            "this lifecycle generation was already reconciled",
            expected_workers=expected_workers,
            reconciliation_key=reconciliation_key,
        )

    cluster_metadata = cluster.get("metadata", {})
    cluster_name = cluster_metadata.get("name")
    cluster_uid = cluster_metadata.get("uid")
    if not cluster_name or not cluster_uid:
        return Decision("blocked", "RayCluster identity is incomplete")
    return Decision(
        "mismatch",
        "RayCluster worker contract is stale",
        expected_workers=expected_workers,
        raycluster_name=cluster_name,
        raycluster_uid=cluster_uid,
        reconciliation_key=reconciliation_key,
    )


class KubernetesClient:
    def __init__(self):
        host = os.environ.get("KUBERNETES_SERVICE_HOST")
        port = os.environ.get("KUBERNETES_SERVICE_PORT_HTTPS", "443")
        if not host:
            raise RuntimeError("KUBERNETES_SERVICE_HOST is missing")
        self.base = f"https://{host}:{port}"
        token_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
        ca_path = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
        self.token = open(token_path, encoding="utf-8").read().strip()
        self.context = ssl.create_default_context(cafile=ca_path)

    def request(
        self,
        method,
        path,
        body=None,
        accepted=(200,),
        content_type="application/json",
    ):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.token}",
                **({} if body is None else {"Content-Type": content_type}),
            },
        )
        try:
            with urllib.request.urlopen(
                request, timeout=20, context=self.context
            ) as response:
                raw = response.read()
                if response.status not in accepted:
                    raise RuntimeError(
                        f"Kubernetes {method} {path} returned HTTP {response.status}"
                    )
                return None if not raw else json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code == 404 and error.code in accepted:
                return None
            if error.code in accepted:
                raw = error.read()
                return None if not raw else json.loads(raw)
            raise RuntimeError(
                f"Kubernetes {method} {path} returned HTTP {error.code}"
            ) from None


class LifecycleController:
    def __init__(self, client, namespace, deployments, grace_seconds, dry_run=False):
        self.client = client
        self.namespace = namespace
        self.deployments = deployments
        self.grace_seconds = grace_seconds
        self.dry_run = dry_run
        self.first_seen = {}
        self.handled = set()
        self.last_reported = {}

    def report(self, deployment_name, level, message, **fields):
        signature = (level, message, tuple(sorted(fields.items())))
        if self.last_reported.get(deployment_name) == signature:
            return
        self.last_reported[deployment_name] = signature
        log(level, message, deployment=deployment_name, **fields)

    def get(self, plural, name, group, version):
        path = (
            f"/apis/{group}/{version}/namespaces/{self.namespace}/"
            f"{plural}/{urllib.parse.quote(name, safe='')}"
        )
        return self.client.request("GET", path, accepted=(200, 404))

    def clusters(self, deployment):
        selector = urllib.parse.quote(f"{DEPLOYMENT_LABEL}={deployment}", safe="")
        path = (
            f"/apis/ray.io/v1/namespaces/{self.namespace}/rayclusters"
            f"?labelSelector={selector}"
        )
        response = self.client.request("GET", path)
        return response.get("items", [])

    def delete_cluster(self, decision):
        path = (
            f"/apis/ray.io/v1/namespaces/{self.namespace}/rayclusters/"
            f"{urllib.parse.quote(decision.raycluster_name, safe='')}"
        )
        body = {
            "apiVersion": "v1",
            "kind": "DeleteOptions",
            "propagationPolicy": "Background",
            "preconditions": {"uid": decision.raycluster_uid},
        }
        self.client.request("DELETE", path, body=body, accepted=(200, 202))

    def mark_reconciled(self, rayservice_name, reconciliation_key):
        path = (
            f"/apis/ray.io/v1/namespaces/{self.namespace}/rayservices/"
            f"{urllib.parse.quote(rayservice_name, safe='')}"
        )
        body = {
            "metadata": {
                "annotations": {RECONCILED_ANNOTATION: reconciliation_key}
            }
        }
        self.client.request(
            "PATCH",
            path,
            body=body,
            accepted=(200,),
            content_type="application/merge-patch+json",
        )

    def reconcile(self, deployment_name, now):
        deployment = self.get(
            "modeldeployments",
            deployment_name,
            "platform.example.com",
            "v1alpha1",
        )
        rayservice = self.get("rayservices", deployment_name, "ray.io", "v1")
        if not deployment or not rayservice:
            self.first_seen.pop(deployment_name, None)
            self.report(
                deployment_name,
                "info",
                "waiting for lifecycle resources",
            )
            return
        decision = evaluate(deployment, rayservice, self.clusters(deployment_name))
        if decision.state != "mismatch":
            self.first_seen.pop(deployment_name, None)
            level = "error" if decision.state == "blocked" else "info"
            self.report(
                deployment_name,
                level,
                decision.reason,
                state=decision.state,
                expected_workers=decision.expected_workers,
            )
            return

        key = decision.reconciliation_key
        if key in self.handled:
            self.report(
                deployment_name,
                "error",
                "lifecycle generation was already handled in this process",
                reconciliation_key=key,
            )
            return
        observed = self.first_seen.get(deployment_name)
        if not observed or observed[0] != key:
            self.first_seen[deployment_name] = (key, now)
            self.report(
                deployment_name,
                "warning",
                "stale RayCluster detected; waiting for grace period",
                raycluster=decision.raycluster_name,
                reconciliation_key=key,
            )
            return
        elapsed = now - observed[1]
        if elapsed < self.grace_seconds:
            return
        if self.dry_run:
            self.report(
                deployment_name,
                "warning",
                "dry-run would delete stale RayCluster",
                raycluster=decision.raycluster_name,
                reconciliation_key=key,
            )
            return

        self.delete_cluster(decision)
        self.handled.add(key)
        self.first_seen.pop(deployment_name, None)
        try:
            self.mark_reconciled(deployment_name, key)
        except Exception as error:  # deletion already succeeded; do not hide it
            log(
                "error",
                "deleted stale RayCluster but failed to persist reconciliation marker",
                deployment=deployment_name,
                error=str(error),
            )
        log(
            "warning",
            "deleted stale controller-owned RayCluster",
            deployment=deployment_name,
            raycluster=decision.raycluster_name,
            expected_workers=decision.expected_workers,
            reconciliation_key=key,
        )


def positive_int(name, default, minimum=1):
    value = int(os.environ.get(name, str(default)))
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def main():
    namespace = os.environ.get("WATCH_NAMESPACE", "model-serving")
    deployments = [
        item.strip()
        for item in os.environ.get("DEPLOYMENT_ALLOWLIST", "").split(",")
        if item.strip()
    ]
    if not deployments:
        raise RuntimeError("DEPLOYMENT_ALLOWLIST must contain at least one deployment")
    poll_seconds = positive_int("POLL_SECONDS", 5)
    grace_seconds = positive_int("MISMATCH_GRACE_SECONDS", 30)
    dry_run = os.environ.get("DRY_RUN", "false").lower() == "true"
    controller = LifecycleController(
        KubernetesClient(), namespace, deployments, grace_seconds, dry_run=dry_run
    )
    log(
        "info",
        "inference lifecycle controller started",
        namespace=namespace,
        deployments=deployments,
        grace_seconds=grace_seconds,
        dry_run=dry_run,
    )
    while True:
        started = time.monotonic()
        for deployment in deployments:
            try:
                controller.reconcile(deployment, started)
            except Exception as error:
                log(
                    "error",
                    "reconciliation failed",
                    deployment=deployment,
                    error=str(error),
                )
        time.sleep(poll_seconds)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log("critical", "controller terminated", error=str(error))
        sys.exit(1)
