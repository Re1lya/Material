#!/usr/bin/env python3
"""Narrow HTTP capacity checker using the existing A3 NPU exporter metrics."""
import json
import math
import re
import ssl
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = "https://kubernetes.default.svc"
TARGET_NODE = "a3-server-00"
EXPECTED_DEVICE_IDS = {str(item) for item in range(16)}
# The observed A3 exporter refreshes about once per minute. Two intervals keep
# normal scrape jitter available while rejecting a stalled exporter response.
MAX_METRIC_AGE_MS = 120_000

class CapacityEvidenceError(RuntimeError):
    """The exporter did not provide complete, fresh capacity evidence."""

def client_credentials():
    token = open("/var/run/secrets/kubernetes.io/serviceaccount/token", encoding="utf-8").read().strip()
    context = ssl.create_default_context(cafile="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
    return token, context

def kube(path):
    token, context = client_credentials()
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    with urllib.request.urlopen(req, context=context, timeout=10) as response:
        return json.loads(response.read())

def kube_text(path):
    token, context = client_credentials()
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}", "Accept": "text/plain"})
    with urllib.request.urlopen(req, context=context, timeout=10) as response:
        return response.read().decode("utf-8")

def parse_process_metrics(metrics, now_ms=None):
    """Return active device IDs only from a complete, fresh exporter sample.

    The A3 exporter emits one timestamped process-count sample for each device.
    Any missing, duplicate, malformed, future or stale sample makes the check
    reject the request rather than treating the device as idle.
    """
    if not metrics.strip():
        raise CapacityEvidenceError("NPU exporter returned an empty metric response")
    observed = {}
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    for line in metrics.splitlines():
        if not line.startswith("npu_chip_info_process_info_num{"):
            continue
        match = re.fullmatch(r'npu_chip_info_process_info_num\{(?P<labels>[^}]*)\}\s+(?P<value>[^\s]+)\s+(?P<timestamp>[^\s]+)', line)
        if not match:
            raise CapacityEvidenceError("malformed NPU process-count metric")
        chip = re.search(r'(?:^|,)id="([0-9]+)"(?:,|$)', match.group("labels"))
        if not chip or chip.group(1) not in EXPECTED_DEVICE_IDS:
            raise CapacityEvidenceError("process-count metric has an invalid device ID")
        device_id = chip.group(1)
        if device_id in observed:
            raise CapacityEvidenceError(f"duplicate process-count metric for device {device_id}")
        try:
            process_count = float(match.group("value"))
            timestamp_ms = int(float(match.group("timestamp")))
        except ValueError as error:
            raise CapacityEvidenceError("process-count metric has an invalid value or timestamp") from error
        if not math.isfinite(process_count) or process_count < 0:
            raise CapacityEvidenceError("process-count metric has an invalid process count")
        age_ms = now_ms - timestamp_ms
        if age_ms < -5_000 or age_ms > MAX_METRIC_AGE_MS:
            raise CapacityEvidenceError(f"process-count metric for device {device_id} is stale")
        observed[device_id] = process_count
    missing = EXPECTED_DEVICE_IDS - observed.keys()
    if missing:
        raise CapacityEvidenceError("process-count metrics are incomplete: missing " + ",".join(sorted(missing, key=int)))
    return sorted((device for device, count in observed.items() if count > 0), key=int)

def host_processes():
    pods = kube("/api/v1/namespaces/npu-exporter/pods?" + urllib.parse.urlencode({"labelSelector": "app=npu-exporter"})).get("items", [])
    exporter = next((pod for pod in pods if pod.get("spec", {}).get("nodeName") == TARGET_NODE), None)
    if not exporter:
        raise RuntimeError("A3 NPU exporter Pod is unavailable")
    name = exporter["metadata"]["name"]
    # Kubernetes API pod proxy preserves the existing exporter boundary; no
    # privileged container, hostPID, hostPath, shell exec or NPU request needed.
    metrics = kube_text(f"/api/v1/namespaces/npu-exporter/pods/{name}:8082/proxy/metrics")
    return parse_process_metrics(metrics)

def capacity_result(requested, devices, active):
    # Kubernetes/Volcano has no contract for this response's safeDevices list.
    # Until Direct Start writes a reviewed staticDeviceAllocation, any host
    # process makes dynamic allocation unsafe: the scheduler could still choose
    # that occupied device. Refuse rather than infer partial-card placement.
    if active:
        return {
            "allowed": False,
            "requestedNpu": requested,
            "hostProcessesOnDevices": active,
            "reason": "dynamic allocation is blocked while host NPU processes exist",
        }
    return {
        "allowed": len(devices) >= requested,
        "requestedNpu": requested,
        "hostProcessesOnDevices": [],
    }

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/check":
            self.send_error(404); return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 8192: raise ValueError("invalid request size")
            body = json.loads(self.rfile.read(size))
            if body.get("deploymentName") != "qwen38-27b": raise ValueError("deployment is not allow-listed")
            if body.get("targetNode") != TARGET_NODE: raise ValueError("target node is not allow-listed")
            requested = int(body.get("requestedReplicas", 0)) * int(body.get("npuPerWorker", 0))
            devices = sorted(EXPECTED_DEVICE_IDS, key=int) if body.get("targetDevices") == "dynamic-safe-pool" else []
            if requested <= 0 or requested > len(devices): raise ValueError("invalid requested NPU count")
            active = host_processes()
            payload = capacity_result(requested, devices, active)
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(payload).encode())
        except Exception as error:
            self.send_response(503); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(json.dumps({"allowed": False, "error": str(error)}).encode())
    def log_message(self, *_): pass

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
