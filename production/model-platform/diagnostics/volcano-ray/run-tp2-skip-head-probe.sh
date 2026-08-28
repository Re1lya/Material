#!/usr/bin/env bash
# Run from server-00 as an account allowed to execute `sudo k3s kubectl`.
# This is a bounded diagnostic: no model mount, no vLLM process, no Service.
set -euo pipefail

if [[ "${1:-}" != "--confirm-run" ]]; then
  echo "Refusing to create a RayCluster without --confirm-run." >&2
  exit 64
fi

namespace=model-serving-diagnostics
cluster=volcano-ray-tp2-skip-head
timeout_seconds="${TIMEOUT_SECONDS:-300}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
evidence_dir="${EVIDENCE_DIR:-$HOME/qwen38-diagnostics/volcano-ray-tp2-skip-head-$(date +%Y%m%dT%H%M%S%z)}"
mkdir -p "$evidence_dir"

k() { sudo k3s kubectl "$@"; }
capture() {
  local label="$1"
  k -n "$namespace" get raycluster,pod,podgroup -o wide >"$evidence_dir/${label}-objects.txt" 2>&1 || true
  k -n "$namespace" get raycluster "$cluster" -o yaml >"$evidence_dir/${label}-raycluster.yaml" 2>&1 || true
  k -n "$namespace" get podgroup -o yaml >"$evidence_dir/${label}-podgroups.yaml" 2>&1 || true
  k -n "$namespace" get events --sort-by=.lastTimestamp >"$evidence_dir/${label}-events.txt" 2>&1 || true
  k get node a3-server-00 -o yaml >"$evidence_dir/${label}-a3-node.yaml" 2>&1 || true
  k -n volcano-system logs deploy/volcano-scheduler --since=15m >"$evidence_dir/${label}-volcano-scheduler.log" 2>&1 || true
  k -n kube-system logs ds/ascend-device-plugin-daemonset --prefix --since=15m >"$evidence_dir/${label}-ascend-device-plugin.log" 2>&1 || true
}
cleanup() {
  capture cleanup-before-delete
  k -n "$namespace" delete raycluster "$cluster" --ignore-not-found --wait=false || true
  k delete namespace "$namespace" --ignore-not-found --wait=false || true
  printf '%s\n' "Evidence retained at: $evidence_dir" >&2
}
trap cleanup EXIT

# This only verifies Kubernetes' advertised resource count.  The operator must
# separately confirm with `npu-smi info` that chips 8 and 9 remain idle just
# before invoking this script; Docker workloads are invisible to Kubernetes.
allocatable="$(k get node a3-server-00 -o jsonpath='{.status.allocatable.huawei\.com/Ascend910}')"
if [[ "$allocatable" != "16" ]]; then
  echo "Refusing: a3-server-00 advertises $allocatable Ascend910 devices, expected 16." >&2
  exit 65
fi
# Other workloads may use a disjoint static pair (for example 14/15).  Reject
# only a claim that overlaps this probe's fixed 8/9 pair; host-Docker use is
# still guarded by the required immediate npu-smi preflight.
if k get pod -A -o jsonpath='{range .items[?(@.spec.nodeName=="a3-server-00")]}{.metadata.namespace}{"/"}{.metadata.name}{" "}{.metadata.annotations.huawei\.com/Ascend910}{"\n"}{end}' | grep -Eq 'Ascend910-(8|9)(,|$)'; then
  echo "Refusing: Kubernetes already records a claim on probe chip 8 or 9." >&2
  exit 66
fi

capture baseline
k apply -f "$script_dir/raycluster-tp2-skip-head.yaml"

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
  capture "sample-${SECONDS}"
  phase="$(k -n "$namespace" get raycluster "$cluster" -o jsonpath='{.status.state}' 2>/dev/null || true)"
  worker_phase="$(k -n "$namespace" get pods -l app.kubernetes.io/component=ray-worker -o jsonpath='{range .items[*]}{.status.phase}{end}' 2>/dev/null || true)"
  if [[ "$phase" == "ready" || "$worker_phase" == "Running" || "$worker_phase" == "Failed" ]]; then
    break
  fi
  sleep 15
done
capture final
echo "Probe completed; cleanup will now run. Evidence: $evidence_dir"
