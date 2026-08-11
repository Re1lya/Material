# Crossplane control plane

This directory records the production Crossplane control-plane bootstrap for
the model platform.

## Current safety boundary

- Crossplane Core and RBAC Manager run as one replica each on `server-00`.
- No Provider, Function or Configuration package is installed by the Core
  release.
- Package and function caches use bounded, disposable `emptyDir` volumes.
- No PVC, NPU workload, RayService, model-cache Job, Composition or
  `ModelDeployment` instance is created in this phase.
- `ModelDeployment` is a namespaced platform API. Its XRD constrains user input
  to references and approved high-level placement; it deliberately exposes no
  image, command, physical NPU ID or arbitrary resource values.

The XRD is an API contract only. A reviewed Pipeline-mode Composition and its
pinned internal Function image must be installed before any
`ModelDeployment` object is admitted into the GitOps path.

## Pinned inputs

- Crossplane and chart: `2.3.4`
- Chart checksum and source image digests: `versions.lock.yaml`
- Runtime image: the internal registry image pinned by Linux/AMD64 manifest
  digest in `values-production.yaml`

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
