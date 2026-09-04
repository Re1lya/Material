#!/usr/bin/env python3
"""Narrow HTTP capacity checker using the existing A3 NPU exporter metrics."""
import json
import re
import ssl
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = "https://kubernetes.default.svc"
TOKEN = open("/var/run/secrets/kubernetes.io/serviceaccount/token", encoding="utf-8").read().strip()
CTX = ssl.create_default_context(cafile="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
TARGET_NODE = "a3-server-00"

def kube(path):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=10) as response:
        return json.loads(response.read())

def kube_text(path):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "text/plain"})
    with urllib.request.urlopen(req, context=CTX, timeout=10) as response:
        return response.read().decode("utf-8")

def host_processes(device_ids):
    pods = kube("/api/v1/namespaces/npu-exporter/pods?" + urllib.parse.urlencode({"labelSelector": "app=npu-exporter"})).get("items", [])
    exporter = next((pod for pod in pods if pod.get("spec", {}).get("nodeName") == TARGET_NODE), None)
    if not exporter:
        raise RuntimeError("A3 NPU exporter Pod is unavailable")
    name = exporter["metadata"]["name"]
    # Kubernetes API pod proxy preserves the existing exporter boundary; no
    # privileged container, hostPID, hostPath, shell exec or NPU request needed.
    metrics = kube_text(f"/api/v1/namespaces/npu-exporter/pods/{name}:8082/proxy/metrics")
    active = []
    for line in metrics.splitlines():
        if not line.startswith("npu_chip_info_process_info_num{"):
            continue
        labels, value = line.split("} ", 1)
        chip = re.search(r'id="([0-9]+)"', labels)
        if chip and chip.group(1) in device_ids and float(value.split()[0]) > 0:
            active.append(chip.group(1))
    return sorted(set(active), key=int)

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
            devices = [str(item) for item in range(16)] if body.get("targetDevices") == "dynamic-safe-pool" else []
            if requested <= 0 or requested > len(devices): raise ValueError("invalid requested NPU count")
            active = host_processes(devices)
            safe = [device for device in devices if device not in active]
            payload = {"allowed": len(safe) >= requested, "requestedNpu": requested, "safeDevices": safe, "hostProcessesOnDevices": active}
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(payload).encode())
        except Exception as error:
            self.send_response(503); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(json.dumps({"allowed": False, "error": str(error)}).encode())
    def log_message(self, *_): pass

ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
