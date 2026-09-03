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
  `dff07544dc392e4ce07c1b3b4f34c228a8cd7b10`.
- Config feature branch: `feat/modeldeployment-v2-serving`, head
  `8eb6dc9dfa4af9dab994e0179775480a0f569333`.
- AMD64 image: `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.11-model-deployments-v2-dff0754@sha256:1de628a4c0e73636089ce66fb0f2029a8630e94bea5792ec5052ece9238ba82c`.
- Image labels bind the source repository, the Backstage feature commit and
  version `0.6.11-model-deployments-v2-dff0754`.

## Release blockers

The Gitea feature branches are pushed, but Gitea API creation requires an API
token: its account password works for Git-over-HTTP but is rejected by the API.
The external proxy returns 502 for authenticated API requests, and the direct
Gitea endpoint returns 401 for Basic/token credentials. A PR must therefore be
opened from the branch URL by an authenticated Gitea browser session or with a
repository-scoped API token. Do not publish, apply, merge, switch
`qwen38-27b`, open a Running Window, or create a smoke workload from this
candidate.
