# Direct ModelDeployment operations candidate — 2026-09-04

## Source and image provenance

- Backstage implementation PR: `gitadmin/platform-backstage#3` (merged as `2978642c7aca85f23f34c2bd9270262c8ea11047`)
- Backstage migration-runner PR: `gitadmin/platform-backstage#4` (merged as `cb7a9fd93cb1dd025dafa13d6c1975e51ae2c678`)
- Candidate source head: `cb7a9fd93cb1dd025dafa13d6c1975e51ae2c678`
- Candidate image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.12-direct-operations-cb7a9fd-r1@sha256:0b8f9ca4a22c741c80c58502f21ecfff554e923e78c4599a2a24e52a2c4ead80`
- Architecture: `linux/amd64`
- OCI source label: `http://110.120.0.3:30081/gitadmin/platform-backstage`
- OCI revision label: `cb7a9fd93cb1dd025dafa13d6c1975e51ae2c678`

## Candidate scope

- explicit `serve:8000` probing and stable-service contract;
- Stop allowed from every live Running phase except an existing Stop;
- versioned Backstage database configuration and operation records;
- feature-flagged direct API that patches only `model-serving/qwen38-27b`;
- independent capacity checker required for Start;
- resourceVersion concurrency check and serving-evidence operation phases;
- legacy GitOps actions retained as a disabled-by-default rollback path.

## Release boundary

This image has not been rolled out. Direct operations remain `enabled: false`.
No RBAC patch, Argo ownership migration, database table creation, Composition
apply, ModelDeployment patch or NPU workload was performed by building it.

## Final pre-release checks

- backend health/operations tests: 3 suites, 14 assertions passed;
- Dashboard tests: 3 suites, 12 assertions passed;
- backend build and explicit migration-runner TypeScript compilation passed;
- server-side dry-run passed for Backstage RBAC, the scoped Backstage/model-serving
  NetworkPolicies, capacity-checker and cache-reaper manifests;
- server-side dry-run passed for the ModelDeployment XRD plus both retained v1
  and v2 stopped Compositions.
