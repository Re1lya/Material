# Crossplane foundation (control-plane only)

This Kustomization is the safe first step for the model-serving platform. It
contains only the provider ServiceAccount/target Role/RoleBinding,
`DeploymentRuntimeConfig`, the namespaced `ModelDeployment` XRD and the
reviewed Qwen3.8 Composition source. It does not install a provider package,
create a ProviderConfig, create an XR, or create any PVC, Job, RayService,
Service or NPU workload.

The provider package and ProviderConfig are intentionally separate release
gates. They may be added only after the `provider-kubernetes` v1.0.0 package is
mirrored to Artifact Keeper, its immutable digest is recorded, its generated
RBAC is audited, and the provider CRDs pass server-side validation. Until then,
the foundation can be applied to Crossplane without changing `gpu-server-00`.

## Apply order

1. Server-side dry-run this Kustomization against the existing Crossplane API.
2. Apply it from the platform control-plane release path.
3. Confirm the XRD remains `Established=True` and the existing runtime-zero XR
   is still `Synced/Ready` with zero replicas.
4. Only after the package gate, apply the Provider and namespaced ProviderConfig.
5. Render a stopped Qwen3.8 XR; do not set `Running` or create model objects in
   this foundation phase.

The directory contains no model bytes and performs no ModelScope or Artifact
Keeper model download.
