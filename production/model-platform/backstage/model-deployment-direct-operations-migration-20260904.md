# ModelDeployment direct-operations migration

## Approved boundary

`qwen38-27b` is the sole instance in this phase. GitOps continues to own the
platform contract (XRD, Compositions, RuntimeProfile, schema, image digests and
policy). Backstage PostgreSQL owns versioned user configuration and operation
history. The direct operations API writes only the current `ModelDeployment`
CR, using its `resourceVersion`.

Direct operations are initially feature-flagged off. The legacy Gitea
Start/Stop actions remain available only as the rollback path.

## Required one-time ownership migration

Before enabling the direct API, remove the instance manifest from the Argo
Application source path while keeping prune disabled. Then dry-run the exact
live XR metadata patch that removes Argo tracking annotations/labels. Do not
use `ignoreDifferences`: it would leave two controllers capable of changing the
same desired state.

Preconditions and evidence:

1. `qwen38-27b` is Stopped, `Synced=True`, `Ready=True`, and has no RayService,
   RayCluster, Pod, Job or PVC.
2. The target source removal does not include XRD, Composition, RuntimeProfile,
   schema, image digest or platform policy files.
3. Argo prune and self-heal remain disabled.
4. Server-side dry-run proves the only live object affected is the named
   `model-serving/qwen38-27b` ModelDeployment metadata.

Rollback: restore the exact instance manifest to the manual Argo path, restore
the recorded Argo tracking metadata, keep the direct API feature flag off, and
confirm the stopped v2 Composition reconciles the XR.

## Direct API permissions

The Backstage ServiceAccount receives `get/list/watch/patch` on
`platform.example.com/modeldeployments` in `model-serving`. It receives no
write permission for Pods, RayService/RayCluster, Secrets, PVCs, Jobs,
Compositions, XRDs or Argo Applications. The patch is constrained in code to
the fixed instance and includes the observed `resourceVersion`.

## Orphan cache Pod cleanup

Backstage never deletes Pods. A separate lifecycle reaper is required before
direct Stop is enabled in production. Its candidate algorithm is:

1. list Pods only in `model-serving`;
2. select only the current deployment label and exact cache-revision label;
3. require `status.phase` to be `Succeeded` or `Failed`;
4. require no ownerReference;
5. verify the corresponding Stop operation and XR are Stopped before deletion;
6. delete only that exact Pod UID; never delete a PV, Retain PV claim, or cache
   directory.

The reaper uses a distinct ServiceAccount/Role and no other workload
permissions. It must be dry-run and shadow-logged against the stopped smoke
instance before any delete permission is applied.

## Direct Start timing

The API records `Requested`, `Validating`, `Applying` and `Reconciling` in the
database. It does not declare success from a patch, Pod, Service or RayCluster.
The Dashboard progresses through `ModelLoading`, `ServingPending` and `Healthy`
only from Crossplane/Ray/EndpointSlice/`/v1/models` evidence. A Start requires
the independent capacity checker; missing or failed capacity evidence rejects
the request rather than falling back to a Git PR or bypassing host NPU checks.
