# Model deployment dashboard and v2 candidate — 2026-09-02

## Scope

This Material-only candidate adds the dashboard/recipe integration needed for
versioned inference requests. It is **not deployed** and must be transplanted
onto the verified current `gitadmin/platform-backstage` main commit before any
image build or production review.

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

## Release blockers

No authenticated read access is available from this session to production
Gitea or `server-00`; consequently the current source provenance, production
image digest, cluster state, Gitea branch/PR, Artifact Keeper digest, Tekton
generation and real authenticated route screenshot have not been verified.
Do not publish, apply, merge, switch `qwen38-27b`, open a Running Window, or
create a smoke workload from this Material candidate.
