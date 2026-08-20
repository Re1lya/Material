# Qwen3.8 A3 Ray Serve LLM runtime

This directory defines the thin, reproducible runtime layer required by the
Qwen3.8 A3 image for `ray.serve.llm`. It deliberately keeps the vendor-provided
Ascend stack unchanged:

- Python `3.12.13`;
- Ray `2.48.0`;
- vLLM `0.23.0`;
- the image-provided vLLM-Ascend, CANN, torch and torch-npu packages.

The upstream image imports `ray.serve` but does not contain the complete Ray
`llm` extra. `requirements.lock` contains only the missing top-level packages.
The ARM64 wheels are downloaded on the approved jumper, checked against
`wheelhouse/SHA256SUMS`, transferred to the isolated A3 build context and
installed with `--no-index`. Wheel binaries are intentionally excluded from
Git; the final image and its immutable digest are published to Artifact Keeper.

Build on an ARM64 A3 host with the already validated source image:

```bash
docker build \
  --build-arg BASE_IMAGE=quay.io/ascend/vllm-ascend:qwen3.8-a3 \
  --tag qwen38-ray-runtime:ray2.48.0-v1 \
  .
```

Before release, compare `pip check` with the source-image baseline. Existing
vendor-image warnings are recorded separately; the derived image must add no
new conflict. The build runs `validate_runtime.py --mode build`, an NPU-free
hard gate that checks the architecture, pinned versions and every added Ray
LLM dependency. After the image is built, run `--mode runtime` with the host
Ascend driver libraries mounted; that second gate imports `ray.serve.llm` and
vLLM-Ascend without loading a model or allocating an NPU.

`a3-registries.yaml` preserves the A3 node's existing `8889` mirror and adds
Artifact Keeper's trusted in-cluster HTTP endpoint at `30670`. It contains no
credentials; Kubernetes workloads must still use a namespace-scoped read-only
image pull Secret. Install it only during an approved idle window and verify
all pre-existing Pods after the k3s-agent restart.

If a workload starts after the idle check, do not restart the agent. Install
the durable `a3-registries.yaml`, then place `a3-containerd-hosts.toml` in the
active k3s containerd `certs.d/110.120.0.3:30670/` directory. Containerd reads
that host entry dynamically; the durable registry file regenerates it on the
next normal agent restart.

`cpu-smoke-pod.yaml` verifies the immutable Artifact Keeper digest, image pull
Secret, A3 placement and Ray LLM import without requesting or mounting an NPU.
Delete the completed Pod after its PASS log is recorded; it is not part of the
steady-state deployment.
