# Model deployment dashboard and v2 candidate — 2026-09-02

## Scope

This candidate has been transplanted onto verified production Gitea main
`gitadmin/platform-backstage@9485ecfc4ca83876e36842e81bdf1612a5c5b9fd`.
It is **not deployed**.

## Candidate contract

- v1 remains unchanged: `modeldeployment-stopped-v1alpha1` and
  `modeldeployment-qwen38-ray-v1alpha1`.
- v2 candidates are `modeldeployment-stopped-v2` and
  `modeldeployment-qwen38-ray-v2`; the Ray candidate has `maxReplicas: 4`.
- The Backstage generator derives `spec.runtime.serving` and `serveConfigV2`
  from a single bounded request. Start changes both composition references to
  the v2 Ray name; Stop changes both back to the v2 stopped name.
- Tekton candidate policy uses one v2 pair and validates worker replicas from
  `runtime.serving.requestedReplicas`. The prior Tekton generation and v1 pair
  remain the rollback baseline.

## Validation performed locally

- TypeScript check, app tests, backend tests and backend build passed.
- The ModelDeployment schema and validator passed for existing v1 requests and
  temporary v2 Stopped plus two-replica Running requests.
- Worker readiness tests cover both v1 and v2 and retain the local Raylet
  `localhost:52365/api/local_raylet_healthz` contract.
- Lifecycle policy tests passed for the v2 pair.

## Catalog schema correction

The initial v2 candidate added structured parallelism defaults to the
RuntimeProfile but did not add those optional fields to
`modelruntimeprofile.schema.json`. PR #46 therefore failed its first Tekton
catalog validation. Commit `88f7a26` adds the four backward-compatible enum
fields (`tensorParallelSize`, `dataParallelSize`, `pipelineParallelSize`, and
`requestedReplicas`). The complete local catalog validation now passes; the
replacement production Tekton run remains the merge gate.

## Candidate provenance

- Backstage feature branch: `feat/model-deployments-v2-dashboard`, head
  `175944de36f13633bc6f76f22e142249c7032bf1`, rebased onto current main
  `85fbdcf`.
- Config feature branch: `feat/modeldeployment-v2-serving`, head
  `8b9b41d3f7ee53f330adf8262745338b46ad94f7` (a no-op CI retrigger commit
  after the schema correction `88f7a26`).
- AMD64 image: `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.11-model-deployments-v2-175944d@sha256:7f3e338cc96d56411fbe6b908174e15e5b1fa6f3647772ab024438d61a918537`.
- Image labels bind the source repository, the Backstage feature commit and
  version `0.6.11-model-deployments-v2-175944d`.

## Release blockers

Both Gitea PRs now exist: `platform-backstage` PR #1 and
`model-platform-config` PR #46. PR #46's exact retrigger head
`8b9b41d3f7ee53f330adf8262745338b46ad94f7` passed Tekton PipelineRun
`model-platform-config-validation-h62nd`. The remaining gates are human PR
review, a server-side dry-run of the v2 control-plane objects, and isolated
v2 smoke acceptance. Do not apply, merge, switch `qwen38-27b`, open a Running
Window, or create a smoke workload until those gates are explicitly approved.
