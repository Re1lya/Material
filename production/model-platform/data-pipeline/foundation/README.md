# K12 data-pipeline CPU-only foundation

> **Historical/superseded material. Do not apply this Kustomization to
> production.** The production K12 CPU integration now uses the complete KCC
> business pipeline described in `../k12-platform-integration-plan-20260827.md`
> and the 2026-08-28 cutover records. These files are retained to document the
> earlier empty-control-plane safety design, dry-run gates and lessons learned.

This is a **non-applied** first release unit for a new Dagster control plane.
It is deliberately separate from the existing `k12/mineru-dagster` workload.

## What it renders

- `k12-data-pipeline` namespace;
- a 20Gi static local PV/PVC on `server-00`, with `Retain` reclaim policy;
- a ServiceAccount with no mounted Kubernetes API token and no RBAC bindings;
- a non-preempting background PriorityClass and namespace ResourceQuota,
  including a zero Ascend extended-resource quota;
- a one-replica Dagster webserver plus daemon using the immutable Artifact
  Keeper image digest;
- a ClusterIP Service only.

It renders no Ray object, worker, Job, CronJob, NPU request, Ascend host mount,
HostPath source mount, NodePort or ingress. The Deployment is pinned to the
AMD64 `server-00` node.

## Preconditions before any production apply

1. Create `/mnt/data/k12-data-pipeline/dagster-home` on `server-00` with the
   reviewed numeric ownership/permissions for the container process.
2. Create the namespace-local `artifact-keeper-image-pull` imagePullSecret with
   a read-only `container-images` Artifact Keeper token; do not copy a publisher
   credential into the namespace.
3. Recheck `server-00` CPU/memory headroom and confirm no active run in the old
   Dagster needs the same S3 prefixes.
4. Use only the reviewed safe control-plane image
   `0.3.0-control-plane@sha256:c5f80cd6f09becb3493745416f2020ebc3f667f904ff5c8e477be5f524b1e5ba`,
   which loads only `platform_control_plane.definitions`. The older `0.2.0`
   image still loads upstream definitions and must not be applied.
5. Run Kustomize rendering and Kubernetes server-side dry-run. A final `apply`
   is a separate, user-approved production change.

The first release intentionally has no S3 credential and no executable Dagster
job. The later CPU-staging release introduces a separately reviewed, prefix-
scoped MinIO identity and allow-listed definitions.

The image, PV path, Secret names and all resource limits are intentional review
points. This is a Dagster control-plane foundation, not the later Ray/NPU
execution environment.
