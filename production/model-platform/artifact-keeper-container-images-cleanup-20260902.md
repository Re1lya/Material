# Artifact Keeper container-images cleanup — 2026-09-02

## Scope and protection policy

The production `container-images` repository was inventoried before deletion:

- 75 Docker/OCI tags and 203 artifact records;
- API-reported logical/physical usage: `141156469343` bytes;
- direct filesystem usage before cleanup: approximately 100GB;
- repository quota: 50GiB, already exceeded.

The cleanup protected every image digest or tag referenced by live Kubernetes
workloads, Tekton, Crossplane Compositions, ModelDeployments and
TrainingRequests. It also retained the current model cache/runtime, current CI
tools, Crossplane Function/provider packages, the latest legacy Backstage
rollback and `qwen38-ray-runtime:v2` as the previous runtime rollback.

All 27 collected cluster image references passed a Registry manifest check
after cleanup.

## Removed OCI tags

The following tags were older than the seven-day cutoff, not referenced by the
cluster and not selected as rollback baselines:

- `model-cache:a3-20260819`;
- `model-platform-backstage:v0.2.9` through `v0.2.14`;
- `qwen38-ray-runtime:ray2.48.0-v1`;
- `vllm-ascend:qwen3.8-a3`.

The retained versions include:

- `model-cache:qwen38-flat-v2`;
- `model-platform-backstage:v0.2.15`;
- `qwen38-ray-runtime:ray2.48.0-v2` and current `v3`;
- every image referenced by a production object.

Artifact Keeper 1.6.4 uses OCI tag deletion plus a guarded, two-phase storage
GC. The nine deleted manifest/tag records were removed successfully. Blob
reclamation remains subject to the implementation's grace/orphan checks; no
live/shared blob was force-deleted.

## Removed abandoned upload files

Filesystem inspection found old untracked OCI upload temporary files that were
the largest immediately reclaimable waste. Twenty-four `.tmp.*` files dated
2026-08-14 through 2026-08-19 had:

- no open file handles;
- no matching `oci_upload_sessions`, `oci_upload_parts` or
  `oci_upload_cleanup_keys` record;
- no relationship to a published image manifest.

They were deleted by an exact, validated path list. Direct filesystem usage for
`container-images` dropped from approximately 100GB to 86GB, immediately
freeing about 14GB.

Three 2026-09-01 upload sessions remained in `committing` state. Two reference
17GB part files. They were less than 24 hours old during this cleanup and were
not manually deleted. Recheck them after the safety window and allow the
Artifact Keeper GC path to handle them where possible.

## Tekton and model cache Pod retention

`TektonPruner/pruner` now uses:

```text
ttlSecondsAfterFinished: 86400
successfulHistoryLimit: 10
failedHistoryLimit: 10
```

Terminal PipelineRuns/TaskRuns and their owned Pods are retained for 24 hours.

The model cache Job does not use Kubernetes `ttlSecondsAfterFinished`. It is a
Crossplane-managed readiness resource; deleting the Job by TTL while the model
remains Running could cause Crossplane to recreate and rerun it. Its Completed
Pod remains while Running and is removed by the zero-resource Stop transition.

## Acceptance

- Artifact Keeper `/health`: healthy, version 1.6.4;
- backend/web Deployments: 1/1 Ready;
- all 27 protected image references: manifest readable;
- Registry repositories: 18 after removing the obsolete `vllm-ascend` repo;
- no production workload image reference was changed.
