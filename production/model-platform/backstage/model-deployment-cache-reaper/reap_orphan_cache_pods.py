#!/usr/bin/env python3
"""Delete only terminal, unowned cache Pods after a stopped XR converges."""
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request

NAMESPACE = "model-serving"
DEPLOYMENT = "qwen38-27b"
API = "https://kubernetes.default.svc"

token = open("/var/run/secrets/kubernetes.io/serviceaccount/token", encoding="utf-8").read().strip()
context = ssl.create_default_context(cafile="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")

def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Accept": "application/json", "Authorization": f"Bearer {token}",
        **({} if data is None else {"Content-Type": "application/json"}),
    })
    with urllib.request.urlopen(req, context=context, timeout=15) as response:
        return None if not response.read() else json.loads(response.read())

xr = request("GET", f"/apis/platform.example.com/v1alpha1/namespaces/{NAMESPACE}/modeldeployments/{DEPLOYMENT}")
conditions = {item.get("type"): item.get("status") for item in xr.get("status", {}).get("conditions", [])}
if xr.get("spec", {}).get("desiredState") != "Stopped" or conditions.get("Synced") != "True" or conditions.get("Ready") != "True":
    print("cache_reaper=SKIPPED xr_not_converged_stopped")
    raise SystemExit(0)

revision = xr.get("spec", {}).get("cache", {}).get("revision")
if not revision:
    raise SystemExit("cache_reaper=FAIL cache revision is absent")
workload_selector = urllib.parse.urlencode({"labelSelector": f"platform.example.com/deployment={DEPLOYMENT}"})
for path in (
    f"/apis/ray.io/v1/namespaces/{NAMESPACE}/rayservices?{workload_selector}",
    f"/apis/ray.io/v1/namespaces/{NAMESPACE}/rayclusters?{workload_selector}",
):
    if request("GET", path).get("items", []):
        print("cache_reaper=SKIPPED runtime_resources_remain")
        raise SystemExit(0)
jobs = request("GET", f"/apis/batch/v1/namespaces/{NAMESPACE}/jobs?{workload_selector}").get("items", [])
if any(job.get("status", {}).get("active", 0) for job in jobs):
    print("cache_reaper=SKIPPED active_cache_job_remains")
    raise SystemExit(0)
selector = urllib.parse.urlencode({"labelSelector": f"platform.example.com/deployment={DEPLOYMENT},platform.example.com/cache-revision={revision}"})
pods = request("GET", f"/api/v1/namespaces/{NAMESPACE}/pods?{selector}").get("items", [])
deleted = []
for pod in pods:
    metadata = pod.get("metadata", {})
    labels = metadata.get("labels", {})
    if labels.get("app.kubernetes.io/component") != "model-cache":
        continue
    if metadata.get("ownerReferences"):
        continue
    if pod.get("status", {}).get("phase") not in {"Succeeded", "Failed"}:
        continue
    name, uid = metadata.get("name"), metadata.get("uid")
    if not name or not uid:
        continue
    request("DELETE", f"/api/v1/namespaces/{NAMESPACE}/pods/{name}", {"preconditions": {"uid": uid}})
    deleted.append(name)
print("cache_reaper=PASS deleted=" + ",".join(deleted or ["none"]))
