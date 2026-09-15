#!/usr/bin/env python3
"""Narrow HTTP capacity checker using the existing A3 NPU exporter metrics."""
import json
import ipaddress
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
SOFT_POOL_MODE = "configmap-soft-pool"
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

def exporter_metrics_url(pod):
    pod_ip = str(pod.get("status", {}).get("podIP", ""))
    try:
        address = ipaddress.ip_address(pod_ip)
    except ValueError as error:
        raise RuntimeError("A3 NPU exporter Pod IP is invalid") from error
    if address.version != 4:
        raise RuntimeError("A3 NPU exporter Pod IP must be IPv4")
    return f"http://{address}:8082/metrics"

def http_text(url):
    req = urllib.request.Request(url, headers={"Accept": "text/plain"})
    with urllib.request.urlopen(req, timeout=15) as response:
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
    # The API-server pod proxy depends on the kubelet tunnel and can time out
    # even when the pod network is healthy. Resolve only the allow-listed A3
    # exporter Pod through Kubernetes, then use the NetworkPolicy-bounded
    # pod-IP endpoint directly. No privileged container, hostPID, hostPath,
    # shell exec or NPU request is used.
    metrics = http_text(exporter_metrics_url(exporter))
    return parse_process_metrics(metrics)

def parse_device_pool(value):
    """Parse the reviewed ConfigMap allow-list used by Direct Operations."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("target device pool is empty")
    devices = [item.strip() for item in value.split(",")]
    if any(item not in EXPECTED_DEVICE_IDS for item in devices):
        raise ValueError("target device pool contains an invalid device ID")
    if len(set(devices)) != len(devices):
        raise ValueError("target device pool contains duplicate device IDs")
    return sorted(devices, key=int)

def select_devices(requested, devices, active):
    """Select one topology-aligned contiguous block from the soft pool.

    The first release is intentionally limited to one worker Pod.  Aligned
    blocks preserve the pairs/quads/octets used by the reviewed A3 TP profiles
    instead of choosing arbitrary free IDs across module boundaries.
    """
    available = set(devices) - set(active)
    for start in range(0, 16, requested):
        block = [str(item) for item in range(start, start + requested)]
        if set(block).issubset(devices) and set(block).issubset(available):
            return block
    return []

def capacity_result(requested, devices, active):
    selected = select_devices(requested, devices, active)
    return {
        "allowed": len(selected) == requested,
        "requestedNpu": requested,
        "configuredPoolDevices": devices,
        "hostProcessesOnDevices": active,
        "hostProcessesInConfiguredPool": sorted(set(active) & set(devices), key=int),
        "selectedDevices": [f"Ascend910-{item}" for item in selected],
        **({} if selected else {"reason": "configured NPU pool has no free topology-valid device block"}),
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
            replicas = int(body.get("requestedReplicas", 0))
            if replicas != 1: raise ValueError("soft-pool allocation currently supports exactly one worker replica")
            requested = replicas * int(body.get("npuPerWorker", 0))
            if body.get("targetDevices") != SOFT_POOL_MODE: raise ValueError("target device mode is not allow-listed")
            devices = parse_device_pool(body.get("targetDeviceIds"))
            if requested <= 0 or requested > len(devices): raise ValueError("invalid requested NPU count")
            active = host_processes()
            payload = capacity_result(requested, devices, active)
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(payload).encode())
        except Exception as error:
            self.send_response(503); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(json.dumps({"allowed": False, "error": str(error)}).encode())
    def log_message(self, *_): pass

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
