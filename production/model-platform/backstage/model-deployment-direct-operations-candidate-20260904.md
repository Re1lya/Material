# Direct ModelDeployment operations candidate — 2026-09-04

## Source and image provenance

- Backstage PR: `gitadmin/platform-backstage#3`
- Candidate source head: `9b3e7c6a5bdd7add98a82726f6ee80d460c1445f`
- Candidate image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.12-direct-operations-9b3e7c6@sha256:305b61c8648a9503036f98252db454cfa6f5a174660f2db0420b56f9de4f9ea7`
- Architecture: `linux/amd64`
- OCI source label: `http://110.120.0.3:30081/gitadmin/platform-backstage`
- OCI revision label: `9b3e7c6a5bdd7add98a82726f6ee80d460c1445f`

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
