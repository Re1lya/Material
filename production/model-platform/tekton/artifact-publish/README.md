# Artifact publish Tekton MVP

This is a separate, opt-in namespace for the Backstage artifact-management
MVP. It does not modify the existing `model-platform-ci` validation pipeline,
does not create model-serving objects, and does not request an accelerator.
Every TaskRun is pinned to `server-00` and `amd64`; the manifests contain no
`huawei.com/*` resource request and no toleration for an NPU taint.

## Contract

Backstage sends metadata to the EventListener only:

```json
{
  "repository_key": "model-artifacts",
  "artifact_path": "Qwen3.6-27B-w8a8/manifest.json",
  "source_ref": "staging://qwen36/manifest.json",
  "total_size": 123,
  "checksum_sha256": "<64 lowercase hex>",
  "idempotency_key": "request-20260819-001"
}
```

`source_ref` is resolved below the pre-approved `artifact-publish-staging`
PVC. The PVC is deliberately not created by this kustomization: its capacity,
local PV and source-ingestion process must be approved separately. The browser
never uploads model bytes.

The Pipeline uses Artifact Keeper's resumable API:

1. `POST /api/v1/uploads`;
2. `PATCH /api/v1/uploads/{session_id}` with `Content-Range` per chunk;
3. `PUT /api/v1/uploads/{session_id}/complete`;
4. `GET /api/v1/repositories/{key}/artifacts/{path}` and SHA256 comparison.

Create the namespace-local Secret out of band; do not commit the value:

```bash
kubectl -n artifact-publish create secret generic artifact-keeper-publisher \
  --from-literal=token='<repository-scoped write token>'
```

The publish EventListener is internal-only. Backstage's ServiceAccount can
read PipelineRuns, TaskRuns and pod logs but cannot create, patch or delete
Tekton/Kubernetes resources. Only the EventListener ServiceAccount can create
PipelineRuns, and only the fixed `publish-artifact` Pipeline is referenced.

## Current gate

This directory is a renderable design, not a production release. Before
applying it, validate the Artifact Keeper publisher Secret, staging PVC,
EventListener Service, NetworkPolicy DNS behavior and a small non-NPU test
artifact. Keep the Backstage `artifactManagement` config absent/disabled until
the same checks pass and Backstage is behind stable HTTPS.
