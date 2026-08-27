# K12 Dagster CPU-only foundation preparation record

**Date:** 2026-08-26
**Status:** superseded by the 2026-08-27 safety-tightened foundation;
**not applied** to production.

## Purpose and boundary

This record covers the first independently deployable control-plane unit for
the K12 data pipeline. It is intentionally a new CPU-only Dagster webserver and
daemon foundation, not a replacement for the existing `k12/mineru-dagster`.

This preparation did not create or modify a Kubernetes object. In particular,
it did not create a namespace, local PV/PVC, Secret, Pod, Ray object, Job,
CronJob, NodePort, NPU request or Ascend host mount. No existing workload was
restarted.

## Inputs that were fixed and verified

| Input | Evidence |
| --- | --- |
| KCC source | `panxy1019/kcc` branch `feature/k12-data-pipeline-dev`, commit `2fd605cfe572470f582c4ef9575a5382dd6f9ff2` |
| Control-plane image | `110.120.0.3:30670/container-images/k12-data-pipeline-dagster@sha256:cab853ebd172aa4b04e37d899331448bfad375f7f4c26ba1bb086d518c5bdb89` |
| Image architecture | Registry OCI index has one runnable `linux/amd64` child manifest `sha256:388f5d605afd4cc1947bf1aafd0e2ff479079ae1169ef2bd5bcbe53185991cf6` |
| Image build | Offline Docker build; internal AMD64 Dagster/Ray base plus the reviewed Pillow and pypdfium2 wheelhouse; no build-time network |
| Image functional check | Offline imports of Pillow, pypdfium2, Dagster 1.13.13, Ray 2.48.0 and `clean_qa.mineru_dagster.definitions` succeeded |
| Cluster prerequisites | `server-00` is AMD64; MinIO service resolves as `minio-k12.k12-lake.svc.cluster.local:9000`; existing `local-path` is not used for the planned retained Dagster state PV |

## Prepared release unit

The reviewable source is in `production/model-platform/data-pipeline/foundation/`.
It renders exactly the following eight objects:

| Kind | Name | Intent |
| --- | --- | --- |
| Namespace | `k12-data-pipeline` | Isolates the new control plane from legacy `k12` |
| StorageClass | `k12-data-pipeline-dagster-local` | Static local storage with `Retain` reclaim policy |
| PersistentVolume / Claim | `k12-data-pipeline-dagster-server-00` / `k12-data-pipeline-dagster-home` | 20Gi Dagster run/history state on `server-00` |
| ServiceAccount | `k12-data-pipeline-dagster` | `automountServiceAccountToken: false`; no Role/RoleBinding |
| ConfigMap | `k12-data-pipeline-dagster-config` | SQLite Dagster metadata/log configuration on the PVC |
| Deployment | `k12-data-pipeline-dagster` | One webserver + daemon pair, immutable AMD64 Artifact Keeper image |
| Service | `k12-data-pipeline-dagster` | ClusterIP only; no external listener |

The Deployment is pinned to `server-00` with no accelerator resource. Combined
requests are `750m` CPU and `1792Mi` memory; combined limits are `2` CPU and
`3584Mi` memory. It is not a Ray worker and cannot receive NPU scheduling.

It references, but does not create, two namespace-local Secrets:

- `artifact-keeper-image-pull`: a read-only `container-images` pull token;
- `k12-data-pipeline-s3`: a non-root MinIO credential with only
  `access-key` and `secret-key`, scoped to new staging prefixes.

Neither value is present in this repository or release material.

## Validation record

1. Kustomize rendering on `server-00` produced the eight kinds above; the
   rendered manifest contained only the Artifact Keeper digest image references.
2. Static checks found no `Ray`, `Job`, `CronJob`, `huawei.com/*`, `Ascend`,
   `hostPath`, or `NodePort` object/field in the rendered workload content.
3. API server dry-run accepted the cluster-scoped Namespace, StorageClass and
   PV definitions. A one-shot full server dry-run then correctly failed for the
   namespaced documents because dry-run Namespace creation is not persisted for
   subsequent API requests. This is a Kubernetes dry-run limitation, not a
   resource-schema failure.
4. A complete `kubectl apply --dry-run=client` accepted all eight objects.
5. Follow-up reads proved the dry-run left no `k12-data-pipeline` Namespace,
   StorageClass or PV behind.
6. Legacy baseline after validation: `k12/mineru-dagster` remained `1/1`
   Ready; its existing two-container Pod remained `2/2 Running` with zero
   restarts.

## Required gate before production apply

The following are intentionally unresolved and require a separate approved
release window:

1. Create `/mnt/data/k12-data-pipeline/dagster-home` on `server-00` with
   reviewed numeric ownership and permissions matching the container process.
2. Create the two scoped Secrets interactively; never reuse `minio-k12-root`
   or the Artifact Keeper publisher credential.
3. Recheck current CPU/memory headroom and MinIO staging-prefix policy.
4. Create the namespace first, then repeat a server-side dry-run of the
   namespaced resources before the final scoped apply.
5. Observe rollout, Dagster health, S3 smoke access restricted to staging, and
   the unchanged legacy `k12` workload.

On 2026-08-27, the revised foundation added a non-preempting PriorityClass,
ResourceQuota (including zero Ascend request quota), an ingress policy and
non-root/read-only-root-filesystem settings. Its 11-object client dry-run and
PriorityClass server-side dry-run passed; no target object persisted. The
safe replacement was built offline and published as
`110.120.0.3:30670/container-images/k12-data-pipeline-dagster:0.3.0-control-plane@sha256:c5f80cd6f09becb3493745416f2020ebc3f667f904ff5c8e477be5f524b1e5ba`.
Registry inspection confirmed an AMD64 runnable child, and an offline
container check confirmed the location exposes no jobs. The old `0.2.0` image
still loads upstream definitions and is forbidden for an apply.

No Ray CPU worker, MinerU, Qwen, model cache, pretraining task or NPU workload
is part of this gate. Those require separate runtime and capacity approvals.
