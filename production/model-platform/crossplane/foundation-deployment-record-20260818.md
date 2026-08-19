# Crossplane foundation deployment record

Date: 2026-08-18  
Scope: control-plane foundation only; no model download, quantization, cache or
NPU workload.

## Applied resources

The local `crossplane/foundation/kustomization.yaml` was server-side dry-run
validated and applied to the existing K3s control plane. It contains only:

- `ServiceAccount/provider-kubernetes` in `crossplane-system`;
- `Role/model-serving-provider-kubernetes` and its `RoleBinding` in
  `model-serving`;
- `DeploymentRuntimeConfig/provider-kubernetes-runtime`, pinned to the
  amd64 `server-00` control-plane node with no accelerator request;
- `CompositeResourceDefinition/modeldeployments.platform.example.com`; and
- `Composition/modeldeployment-qwen38-ray-v1alpha1`.

The application used server-side validation first, then a normal apply with a
dedicated field manager. No Provider package, ProviderConfig, ModelDeployment
XR, PVC, Job, RayService or Service was created.

## Verification

- XRD: `Established=True` (`WatchingCompositeResource`).
- Qwen3.8 Composition: registered successfully.
- `model-serving`: no PVC, Job, RayService or Service from this release unit.
- Provider package and namespaced ProviderConfig CRDs were not installed at the
  time of this foundation record; they were gated on an Artifact Keeper mirror
  and generated-RBAC audit.
- Provider ServiceAccount checks: target `model-serving` ConfigMap/PVC/Job
  access is allowed; another namespace PVC creation, node access, Secret access
  and `rayclusters` creation are denied.
- No provider Pod was present and `gpu-server-00` retained its existing
  allocatable NPU count; no NPU request was created.

## Resume read-only check at the foundation boundary

After the repository changes were resumed, a read-only check against the
production kubeconfig confirmed the same boundary: `providerconfigs.kubernetes`
and `objects.kubernetes` CRDs are absent, no Provider/ProviderRevision or
ProviderConfig resource is present, and `model-serving` has no PVC, Job,
RayService or Service from this release. `gpu-server-00` remains `arm64` with
8 allocatable `huawei.com/Ascend910` devices; only the pre-existing
`kube-system`, `mindx-dl`, `monitoring` and `npu-exporter` Pods were listed.
Only the metadata of `artifact-keeper-crossplane-pull` was inspected; no
Secret value was read.

## Provider package mirror (completed, not installed)

The v1.0.0 `provider-kubernetes` OCI package was copied to
`110.120.0.3:30670/container-images/provider-kubernetes:v1.0.0` and verified
against the upstream index and both platform children:

- index: `sha256:fd54bbc7f87744eaef61cd52647fe6f641d9d5c323619de5527bfb8e1ab7a6ea`;
- Linux/AMD64: `sha256:e0198c31a99eedcfc061c008da56fbffff967f54b211475cd19185408ed2e61d`;
- Linux/ARM64: `sha256:3f9ee3d6fb05f7f92b845c921e235cb62a1dab5905bf19052580144e7b4e8df0`.

The copy used the temporary Service Account `svc-crossplane-provider-mirror`,
restricted to Docker `read/write` on `container-images`, with a one-day expiry.
Its token was revoked after the
digest check; the Service Account is retained with zero active tokens for a
future, separately approved mirror. No token value was stored in Git,
Kubernetes or this record.

The internal digest lock and reviewed package template now point at the
immutable Linux/AMD64 child digest. The Provider package, ProviderConfig and
any provider Pod were not installed at the time of this dated foundation
record.

## Follow-up: provider release completed 2026-08-19

The separately approved provider release was applied after the foundation:

- `Provider/provider-kubernetes` uses the immutable Artifact Keeper package
  digest `sha256:e0198c31a99eedcfc061c008da56fbffff967f54b211475cd19185408ed2e61d`.
- `ProviderConfig/model-serving` uses `InjectedIdentity` and is namespaced to
  `model-serving`; no kubeconfig or token was written to Git.
- The provider revision reports `Installed=True` and `Healthy=True`. Its one
  Pod runs on `server-00` with CPU/memory requests only and the same immutable
  digest through the registered `110.120.0.3:30670` node endpoint. The initial
  runtime pull failed because containerd cannot resolve `*.svc.cluster.local`;
  the explicit runtime image override in `provider-kubernetes/runtime-config.yaml`
  corrected this without changing node configuration.
- Generated RBAC was audited. The provider API/controller role is cluster-scoped
  for Crossplane internals and retains the upstream controller's cluster-scoped
  Secret/ConfigMap/Event/Lease permissions; the target workload permissions
  come from the `model-serving-provider-kubernetes` Role (ConfigMap, PVC, Job,
  Service, NetworkPolicy and `ray.io/RayService`). It cannot create RayCluster,
  PV, StorageClass, Node resources or PVCs in another namespace. Strict
  cluster-wide Secret isolation remains a follow-up hardening decision.
- A temporary namespaced `Object` created and reconciled one ConfigMap with
  `Synced=True/Ready=True`; the Object and ConfigMap were then deleted. This
  verifies ProviderConfig → provider controller → target Role without creating
  a model, PVC, Job, RayService, Service or NPU Pod.

The provider release did not create a ModelDeployment XR and did not touch model
files, `gpu-server-00`, NPU allocation or existing application workloads.

## Follow-up: Qwen3.8 stopped control-plane release 2026-08-19

The XRD schema was corrected before the first Argo sync. Crossplane v2 requires
an explicit scalar `type` alongside `const`/`enum`, and rejects nested
`additionalProperties: false` when the generated structural schema contains
declared properties. The allow-list therefore keeps the top-level structural
contract and adds explicit scalar types for the constrained fields. After
re-applying the XRD and restarting only the Crossplane controller, the generated
CRD was accepted and exposes the Qwen3.8 and control-plane composition values.

The stopped ModelDeployment request was published to Gitea `main` at commit
`45460d9748e116e0b8c8633c64aa1459e9d8d2d0`. Argo Application
`model-platform-deployment-requests` is manual-sync, namespace-scoped and
reported `Synced/Healthy/Succeeded` at follow-up commit
`6fdb3022b791d56cc1cba3a14fce0aca64eec7cf` (the release objects remain
unchanged). Tekton catalog and ModelDeployment validation for that commit
completed `Succeeded` and wrote the Gitea policy status `success`. The XR's internal
Crossplane selector is `modeldeployment-control-plane-v1alpha1`; this explicit
selector is required because the XRD default remains the runtime-zero baseline.
The control-plane Composition reconciles one status ConfigMap with
`phase=AwaitingApproval`, `runtimeEnabled=false`, `cacheEnabled=false` and
`npuRequested=0`.

During the selector transition Crossplane briefly reconciled the old
runtime-zero Deployment/Service and removed them when the control-plane
Composition became active. Final verification found only
`model-serving/qwen38-27b-status`: no Qwen3.8 PVC, Job, RayService, Service,
Deployment, Pod, cache bytes or NPU request. The transient watch-circuit status
was observed after the composition switch; `Synced=True` and `Ready=True`
remained true and no runtime resource was left behind.

The A3 source and Artifact Keeper copy are recorded in
`qwen38-artifact-transfer-record-20260819.md`. The existing Docker/vLLM
processes on `a3-server-00` were inspected read-only; no container, process,
NPU chip, source file or running application was stopped, restarted or
modified.

## Next gated step

Create the first GitOps `ModelDeployment` XR only after the model artifact,
runtime profile, cache storage and Argo CD manual-sync review are approved. Keep
the first XR stopped and control-plane-only; do not start a cache Job or request
an NPU in this phase.
