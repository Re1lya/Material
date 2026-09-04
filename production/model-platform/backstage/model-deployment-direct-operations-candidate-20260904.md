# Direct ModelDeployment operations candidate — 2026-09-04

## Source and image provenance

- Backstage implementation PR: `gitadmin/platform-backstage#3` (merged as `2978642c7aca85f23f34c2bd9270262c8ea11047`)
- Backstage migration-runner PR: `gitadmin/platform-backstage#4` (merged as `cb7a9fd93cb1dd025dafa13d6c1975e51ae2c678`)
- Backstage atomic-migration PR: `gitadmin/platform-backstage#5` (merged as `b73365e68518d69f98e2b607378994f9bfb0e1a6`)
- Candidate source head: `b73365e68518d69f98e2b607378994f9bfb0e1a6`
- Candidate image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.12-direct-operations-b73365e-r1@sha256:f2c1c17f3cff391012c46ce20d1aa9f4f838ac48ae9a6cba348022b9880b8954`
- Architecture: `linux/amd64`
- OCI source label: `http://110.120.0.3:30081/gitadmin/platform-backstage`
- OCI revision label: `b73365e68518d69f98e2b607378994f9bfb0e1a6`

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

## P0 hardening added after review

- the cache reaper reads every Kubernetes API body once, uses `batch` RBAC for
  Jobs, and ships suspended until a manually created shadow Job is inspected;
- the capacity checker fails closed unless it receives one fresh timestamped
  process-count metric for every A3 device `0` through `15`; empty, partial,
  duplicate, malformed and stale responses are rejected. Since Kubernetes does
  not yet receive a reviewed `staticDeviceAllocation`, any detected host NPU
  process blocks the entire dynamic pool rather than allowing an unsafe partial
  allocation (5 unit tests passed, including the HTTP handler);
- the migration now creates all tables and its lock row inside one PostgreSQL
  transaction. The release uses the dedicated one-shot Job manifest, which
  references only `POSTGRES_USER` and `POSTGRES_PASSWORD` from the existing
  `backstage-secrets`; database name and host are non-secret explicit values,
  and no unrelated Gitea, OIDC or session credentials are injected.

## Post-release operating boundary

Direct operations stay disabled in `app-config.production.yaml` for this
release. Since the qwen38 instance file is no longer an Argo request source,
there is intentionally no enabled Start path until the next approved phase:
apply this release, run the suspended reaper as one manually created shadow
Job, perform capacity-checker shadow validation in an approved Running Window,
then enable `modelPlatform.directOperations.enabled` by an explicit audited
configuration rollout. No feature flag is enabled by this release itself.
