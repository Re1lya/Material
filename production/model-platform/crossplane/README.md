# Crossplane control plane

This directory records the production Crossplane control-plane bootstrap for
the model platform.

## Current production boundary

- Crossplane Core and RBAC Manager run as one replica each on `server-00`.
- No Provider or Configuration package is installed. Function Patch and
  Transform `v0.8.2` is installed by immutable digest and is Healthy.
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
primary controller role is cluster-scoped. They grant reconciliation of only
ConfigMaps, Deployments and Services for this Composition. No permissions for
Job, PVC, Secret, Ray, Volcano or NPU-specific custom resource types are added.

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
