# Model Deployment health timeline release — 2026-09-03

## Candidate

- `gitadmin/platform-backstage` main:
  `2a645244f52eadaf0f78de144937f40ded2e78f9`.
- PR #2 health/timeline changes were rebased on training main `db6038f` and
  merged as `eab2cd7`; `2a64524` pins the build to the then-current production
  base image.
- Candidate image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.1-model-health-2a64524@sha256:b3fbe8c105a4c109ad916d4736f16cae7938d0d58474d5add1e9c036cda356a3`.
- Architecture: `linux/amd64`.
- Rollback image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.0-training-eval-db6038f@sha256:b8053654f42dddfcb83c628e20770241601b8e56c141b85e2c841c0d7e82181b`.

## Validation

- Model platform API/status and Dashboard targeted tests: 14/14 passed after
  the final rebase.
- Backstage backend build passed.
- Image labels bind source repository, full source revision and release version.
- The health contract requires ready workers, Ray Serve RUNNING, a ready
  EndpointSlice and a successful bounded `/v1/models` response before showing
  Healthy.
- Failed model probes use a short TTL and may recover within the same
  generation; successful probes are generation-cached with bounded storage and
  response size.

## CI boundary

This release is manually reviewed and is not blocked on a Backstage Tekton
status. The previous experimental Backstage CI objects and failed runs were
removed. A smaller non-blocking PR CI is prepared separately and must not be
described as a prerequisite or as production evidence for this image.

## Production changes awaiting approval

1. Apply the updated read-only EndpointSlice RBAC in `model-serving`.
2. Apply the two narrowly scoped TCP/8000 NetworkPolicies between Backstage and
   platform model-serving Pods.
3. Roll out the candidate Backstage digest.

These changes do not switch a ModelDeployment, install or edit a Composition,
open the Running Window, or create an NPU workload.
