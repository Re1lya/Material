# NPU soft-pool candidate — 2026-09-15

This record separates the reviewed candidate from the unchanged production
state. It contains no credentials, Secret data or kubeconfig material.

## Purpose and scope

Legacy Docker processes can still use A3 devices without appearing in
Kubernetes resource accounting. The previous Direct Operations capacity gate
therefore rejected a Start whenever any of the 16 devices had a host process.
This candidate replaces that temporary all-or-nothing rule with a ConfigMap
soft pool for the approved single-instance inference path.

The initial pool is device IDs `8-15`. The capacity checker still requires a
complete and fresh exporter sample for all devices, but host processes outside
the configured pool no longer block the deployment. Within the pool it selects
the first free topology-aligned block and returns explicit device-plugin names,
for example `Ascend910-10,Ascend910-11`.

Direct Operations validates that the returned devices are unique, have the
expected count and belong to the ConfigMap pool. It then writes the result to
`spec.placement.staticDeviceAllocation`; the existing v2 Composition passes
that field to the worker Pod annotation `huawei.com/Ascend910`. Stop removes
the allocation field and audit annotation.

This release remains deliberately limited to `qwen38-27b`, one worker replica
and the certified TP profile. The existing database operation lock serializes
the only supported instance. Per-device Lease allocation is deferred until
multiple simultaneous inference instances or multiple worker replicas are
introduced.

## Source and image provenance

- Backstage PR: `gitadmin/platform-backstage#13`
- Backstage main: `89295450e3374820d494a0c7a2f88c1d6afbbb11`
- Configuration PR: `gitadmin/model-platform-config#56`
- Configuration main: `a78efeadc9ca285b58a78611789605625f59c70e`
- Build-context archive SHA256:
  `831053acdfbc6fae10f2beac4e674d6f43f54c65931664388ee0011bee7b9e29`
- Candidate image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.19-npu-soft-pool-8929545-r1@sha256:366b777e9a49a95670188f6ed9780ec8871d792c6015ace92f64e5ac8b2ab503`
- Image platform: `linux/amd64`
- OCI revision:
  `89295450e3374820d494a0c7a2f88c1d6afbbb11`

## Validation completed

- Capacity-checker unit tests: 10/10 passed.
- Direct Operations unit tests: 3/3 passed.
- Backstage backend build passed.
- Capacity-checker Kustomize render and server-side dry-run passed.
- Running-gate ConfigMap server-side dry-run passed.
- Configuration PR clone-and-validate TaskRun succeeded for head
  `e432bb1e5c99596fde3597c1a549745577b64d9c` before merge.
- A3 exporter was read without creating a workload and reported device IDs
  `0-15` idle at the observation time. This is not a promise that they remain
  idle at release time.

## Production state and release boundary

Production was not changed while preparing this candidate:

- Backstage remains on
  `0.6.18-direct-operations-contract-60ecc66@sha256:97a13db59301cec4c87fdf97c0537d8b09158a1ca1ee2bd44c88f02ed43f0026`.
- The live gate remains `dynamic-safe-pool`, devices `0-15`, and
  `window-open=false`.
- `qwen38-27b` remains `Stopped`, bound to
  `modeldeployment-stopped-v2`, with Synced/Ready/Responsive true.
- No Kubernetes NPU Pod was observed on `a3-server-00`.

A production release requires a separate explicit approval to apply the merged
capacity-checker and ConfigMap, roll out the candidate Backstage digest, run a
non-NPU API/route acceptance, and only then open a controlled Running Window.
Rollback restores the previous Backstage digest and the prior running-gate and
capacity-checker manifests. Neither path modifies or stops legacy Docker
training processes.

## Production release result

The user approved the non-NPU production release on 2026-09-15. The following
state was observed after the release:

- the capacity-checker ConfigMap was applied and its Deployment was explicitly
  restarted so the fixed-name ConfigMap volume loaded the new script;
- the running-gate ConfigMap now reports `configmap-soft-pool`, device IDs
  `8-15`, and `window-open=false`;
- a real shadow request reached the new checker and returned the configured
  pool and selection evidence without creating any workload;
- at that exact observation time the exporter reported host processes on all
  device IDs `0-15`, so the checker correctly returned `allowed=false` and no
  selected devices; this occupancy belongs outside this release and was not
  modified;
- Backstage rolled out the candidate digest above; the new Pod was Ready with
  zero restarts and its runtime image ID matched the pinned digest;
- `/healthcheck`, `/kcc-pretraining`, `/model-recipes`, `/data-pipeline` and
  `/api/model-platform/deployments` all returned HTTP 200;
- the training controller remained 2/2 Ready and the K12 CPU Dagster
  Deployment remained 1/1 Ready;
- `qwen38-27b` remained `Stopped`, generation 79, with no static allocation and
  Synced/Ready/Responsive true;
- the only Pod in `model-serving` was the CPU-only capacity checker. No
  RayService, cache workload or NPU Pod was started.

The control-plane release is therefore complete. A later NPU smoke requires a
fresh occupancy check, coordination that leaves a topology-valid pair inside
IDs `8-15` free, and a separate decision to open the Running Window.
