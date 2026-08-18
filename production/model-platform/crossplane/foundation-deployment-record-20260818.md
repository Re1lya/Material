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
- Provider package and namespaced ProviderConfig CRDs: not installed yet; the
  package remains gated on an Artifact Keeper mirror and generated-RBAC audit.
- Provider ServiceAccount checks: target `model-serving` ConfigMap/PVC/Job
  access is allowed; another namespace PVC creation, node access, Secret access
  and `rayclusters` creation are denied.
- No provider Pod was present and `gpu-server-00` retained its existing
  allocatable NPU count; no NPU request was created.

## Resume read-only check

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
any provider Pod were not installed.

## Next gated step

Audit the generated provider RBAC, then separately approve and apply the
Provider and namespaced ProviderConfig. That step is separate from this
foundation and must not create a ModelDeployment XR or touch model files.
