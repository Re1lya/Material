# Model cache Job versioning design and validation — 2026-08-28

## Outcome

The Qwen model-cache Job source has been changed from a fixed identity to a
reviewed revision identity:

```text
<model-deployment>-cache-<spec.cache.revision>
```

For the current immutable artifact the revision is:

```text
f2afa9e2-r1
```

It combines the first eight hexadecimal characters of the canonical manifest
digest with a platform Job-template revision. A change to the model artifact
or an immutable Job template must bump this value. Reconciliation of the same
revision remains idempotent; a different revision creates a different
provider-kubernetes Object and Kubernetes Job instead of patching an existing
Job PodTemplate.

## Contract changes

- `ModelDeployment.spec.cache.revision` is required and limited to a short DNS
  label fragment.
- `ModelRuntimeProfile.spec.runtime.cache.revision` is required.
- Tekton validation requires the deployment cache contract to match the
  selected RuntimeProfile.
- The cache revision must start with the first eight characters of the
  artifact manifest digest.
- The generated provider Object, Job and Pod template carry
  `platform.example.com/cache-revision` labels.
- Backstage copies the certified cache revision from the selected
  RuntimeProfile; users cannot enter it.
- Deployment names are limited to 40 characters so the generated versioned
  Job name remains within the Kubernetes 63-character DNS label limit.

## Data boundary

This change versions the Job identity and fixes the current immutable-template
reconciliation failure. It intentionally keeps the current PVC and
`CACHE_TARGET_RELATIVE=model` data layout so the new Job can validate and reuse
the already completed cache without downloading another approximately 30GiB
copy.

It does not yet provide two model weight revisions side by side. Introducing a
new model artifact requires a separately reviewed cache storage expansion or
per-version PVC/data-layout migration. Do not claim multi-version cache
rollback from this Job-name change alone.

## Validation

Local validation completed:

- JSON and YAML parsing passed.
- ModelVersion/ModelRuntimeProfile catalog validation passed.
- ModelDeployment validation passed.
- Backstage TypeScript compilation and focused Recipe tests passed.

The XRD and Composition were copied as a two-file release bundle and accepted
by the production K3s API using server-side dry-run. The dry-run produced only
the existing non-fatal last-applied-configuration field-manager warning and
persisted no object.

## Production gate

Gitea PR #10 updated the production configuration contract. Tekton validated
the exact PR head `0bf417b8f8582ca3db50b7b3f4a6a2a18a912963`; after merge, the
main commit `16d36213c17ba726cf3f087b384e5dd4eaf05bca` also passed the webhook
PipelineRun. Argo CD remains manual and the deployment-request Application is
currently OutOfSync/Healthy, so the merge did not change the live XR or create
the versioned Job.

No production Kubernetes object was changed by this preparation. A later
approved release must coordinate:

1. Gitea catalog/schema/ModelDeployment changes and a green Tekton status.
2. XRD and Composition publication.
3. Selection of the new CompositionRevision by the stopped XR.
4. Observation that the new versioned cache Job validates the existing
   `READY` cache and completes without an NPU request.
5. Removal or retention of the old failed provider Object only after the new
   Job is verified.
