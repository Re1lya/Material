# Crossplane control plane

This directory records the production Crossplane control-plane bootstrap for
the model platform.

## Current production boundary

- Crossplane Core and RBAC Manager run as one replica each on `server-00`.
- No Provider or Configuration package is installed. Function Patch and
  Transform `v0.8.2` is installed by immutable digest and is Healthy.
- The control-plane-only foundation (`foundation/kustomization.yaml`) is
  applied: provider ServiceAccount/namespace Role+RoleBinding,
  `DeploymentRuntimeConfig`, the ModelDeployment XRD and the reviewed Qwen3.8
  Composition are registered. It creates no Provider Pod or managed runtime.
- Package and function caches use bounded, disposable `emptyDir` volumes.
- No PVC, NPU Pod, RayService or model-cache Job is created in this phase.
  Production contains exactly one stopped `ModelDeployment` proof instance.
- `ModelDeployment` is a namespaced platform API. Its XRD constrains user input
  to the currently verified Qwen references, `Stopped` and
  `control-plane-only`; it deliberately exposes no image, command, physical
  NPU ID or arbitrary resource values.

The installed Pipeline-mode `runtime-zero` Composition creates a status
ConfigMap, ClusterIP Service and an exact dormant runtime Deployment. The
Deployment is continuously reconciled to `replicas: 0`, so it creates no Pod
and performs no NPU allocation. It also creates no PVC, cache Job, RayCluster
or RayService. Runtime activation remains a separate NPU-gated phase.

For the focused Qwen3.8-27B rollout, Crossplane is now an explicit runtime
composition layer. Argo CD remains the CD executor and submits a
`ModelDeployment` XR; a pinned `provider-kubernetes` plus a namespace-limited
ProviderConfig/ServiceAccount will create the cache PVC/Job, stopped/Running
RayService, Service and policies. KubeRay then owns the RayService lifecycle.
The current runtime-zero Composition is kept as the control-plane baseline; the
Qwen3.8 Composition is now registered as a separate, reviewed extension but is
not selected by any XR. See `foundation-deployment-record-20260818.md` and
`../qwen38-ray-mvp-plan-20260818.md` for the provider, RBAC, cache gate and
composition sequence.

The reusable first-stage source now lives in
`provider-kubernetes/` (RuntimeConfig, namespaced ProviderConfig, target Role/
RoleBinding and a non-applied package example) and
`composition/modeldeployment-qwen38-ray.yaml`. These files are intentionally
not included in the existing Argo bootstrap Application. The new
`foundation/kustomization.yaml` is the control-plane-only release unit for the
ServiceAccount/Role/RoleBinding, DeploymentRuntimeConfig, XRD and Composition;
it creates no Provider, ProviderConfig, PVC, cache Job, RayService or Service.
The provider package digest, Artifact Keeper cache/runtime image digests and
node-local StorageClass/PV evidence remain separate release gates.

## Pinned inputs

- Crossplane and chart: `2.3.4`
- Chart checksum and source image digests: `versions.lock.yaml`
- Runtime image: the internal registry image pinned by Linux/AMD64 manifest
  digest in `values-production.yaml`
- Function Patch and Transform: `v0.8.2`, with upstream index and Linux/AMD64
  package digests pinned in `versions.lock.yaml`
- Artifact Keeper Function manifest:
  `sha256:070fd3bdb56ec93f825e2f8fcda902bbdaef2e7831e164be5311144867f51dd8`

## Released package path

Crossplane Core resolves the Function package over the cluster-internal HTTPS
name `artifact-keeper-registry.artifact-keeper.svc.cluster.local`, using the CA
from `artifact-keeper-registry-ca`. The Function runtime itself is pulled by
K3s containerd from `110.120.0.3:30670/container-images` with a namespace-local
read-only pull Secret. This split is intentional: Crossplane Core does not use
the node containerd insecure-registry configuration when resolving packages.

The released instance and complete evidence are recorded in
`runtime-zero-deployment-record-20260814.md`.

The aggregate ClusterRoles are necessarily cluster-scoped because Crossplane's
primary controller role is cluster-scoped. The existing runtime-zero roles grant
only ConfigMaps, Deployments and Services. The planned Qwen3.8 Provider uses a
separate ServiceAccount/Role limited to `model-serving`; it will add only the
namespaced permissions for PVC, Job, Service, policy objects and
`ray.io/RayService`. It will not manage PV/StorageClass, nodes, Device Plugin,
other namespaces or existing Ray objects.

## Qwen3.8 Provider and Composition boundary

The foundation source is ready, but the provider package and ProviderConfig are
still deliberately gated. This section does not authorize model download,
quantization, cache creation or an NPU window.

```text
Argo Application
  -> ModelDeployment XR (model-serving)
  -> Crossplane Composition
  -> provider-kubernetes ProviderConfig
  -> PVC + zero-NPU cache Job + stopped RayService + Service/NetworkPolicy
  -> cache READY + desiredState=Running
  -> RayService worker=1
  -> existing KubeRay v1.6.0
```

Required release units:

1. Lock the provider-kubernetes package and mirror its controller image to
   Artifact Keeper; schedule the provider on `server-00` with no NPU request.
2. Create a ProviderConfig with in-cluster credentials and a dedicated
   ServiceAccount/Role/RoleBinding scoped to `model-serving`.
3. Extend the namespaced ModelDeployment XRD with allow-listed Qwen3.8 refs and
   `Running` while preserving the existing stopped/control-plane behavior.
4. Add a Composition that renders provider Objects for the cache PVC, cache Job,
   RayService, Service, NetworkPolicy, Quota and status conditions.
5. Keep the RayService worker replicas at zero until the cache Job is Complete and
   `READY` is verified; then change the XR desired state through Git/Argo.
6. First validate with a stopped XR and harmless namespaced object; only then allow
   the composition to request the 8 NPU worker.

## Validation sequence

```bash
helm lint crossplane-2.3.4.tgz \
  --values production/model-platform/crossplane/values-production.yaml

helm template crossplane crossplane-2.3.4.tgz \
  --namespace crossplane-system \
  --values production/model-platform/crossplane/values-production.yaml

kubectl apply --dry-run=server \
  -f production/model-platform/crossplane/namespace.yaml
```

After Core is Ready, validate and apply the XRD separately. Crossplane installs
its own core CRDs during the init phase, so the XRD cannot pass server-side
validation before Core has registered `CompositeResourceDefinition`.
