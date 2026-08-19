# provider-kubernetes release unit

This directory is the control-plane part of the Qwen3.8 first-stage release.
It is intentionally not included in the current Crossplane bootstrap
Kustomization. The separately audited Provider and namespaced ProviderConfig
release was applied to production on 2026-08-19; the package example remains a
review template rather than the live source of truth.

The upstream provider exposes a namespaced `ProviderConfig`/`Object` API in
the `kubernetes.m.crossplane.io/v1alpha1` group. The source lock records the
v1.0.0 OCI index digest and its Linux/AMD64 child digest in
`../versions.lock.yaml`; the complete package has now been mirrored to Artifact
Keeper and the internal digest recorded. The reviewed package is still named
`provider-package.example.yaml`; it is not a live manifest.

## Package mirror and proxy boundary

`mirror-package.sh` accepts an explicit `TRANSPORT_PACKAGE_REF`. That ref may
be a pull-through registry such as a dockerproxy endpoint when the endpoint
supports the `xpkg.crossplane.io` OCI artifact, or it may be the upstream ref
itself. The script verifies both the upstream index digest and the
Linux/AMD64 child digest, copies the complete OCI package to the Artifact
Keeper Docker repository, and verifies both digests again. The completed
release used the short-lived build-host Service Account
`svc-crossplane-provider-mirror` with Docker-repository `read/write` scope;
its token was revoked immediately after verification. No
Kubernetes Secret is read by the script.

The proxy is only a download transport. Neither a dockerproxy hostname nor an
upstream tag may appear in a production `Provider` manifest. After a successful
copy, record the internal Linux/AMD64 digest in `versions.lock.yaml`, keep the
reviewed package template aligned, and run the generated-RBAC audit before
applying the Provider. A new short-lived writer token must be
issued by an administrator for a later mirror; its value must never enter Git
or a Kubernetes Secret.

Mirror evidence for this release:

- target tag: `110.120.0.3:30670/container-images/provider-kubernetes:v1.0.0`;
- OCI index: `sha256:fd54bbc7f87744eaef61cd52647fe6f641d9d5c323619de5527bfb8e1ab7a6ea`;
- Linux/AMD64 child: `sha256:e0198c31a99eedcfc061c008da56fbffff967f54b211475cd19185408ed2e61d`;
- Linux/ARM64 child: `sha256:3f9ee3d6fb05f7f92b845c921e235cb62a1dab5905bf19052580144e7b4e8df0`.

The Service Account remains as a reusable identity with no active token.

Example (the command is not run by repository validation):

```text
TRANSPORT_PACKAGE_REF=mirror.example/xpkg/provider-kubernetes:v1.0.0@sha256:<same-index-digest> \
TARGET_PACKAGE_REF=110.120.0.3:30670/container-images/provider-kubernetes:v1.0.0 \
./mirror-package.sh
```

If a proxy cannot serve the Crossplane xpkg registry, use a controlled build
host with the upstream `xpkg.crossplane.io` ref; do not make the cluster pull
from the proxy directly.

## Identity and permissions

`provider-rbac.yaml` pre-provisions the provider ServiceAccount in
`crossplane-system`, then binds only a Role in `model-serving`.  The Role can
manage the objects emitted by the Qwen3.8 Composition:

- PVC, Job, ConfigMap and Service;
- NetworkPolicy; and
- `ray.io/RayService` (the KubeRay operator, not this provider, owns the
  generated RayCluster and Pods).

The target Role does not grant access to Secrets, PV/StorageClass, Nodes,
device plugins, other namespaces or `rayclusters`. The package's generated
controller role is separate and retains the provider API plus the upstream
cluster-scoped Secret/ConfigMap/Event/Lease permissions required by the
package controller; it adds no target PVC/Job/RayCluster or node binding.
`ProviderConfig` uses `InjectedIdentity`, so no kubeconfig or token is stored
in Git. If strict cluster-wide Secret isolation is required later, use a
custom provider package or a separately scoped target-cluster credential as a
follow-up hardening step.

The DeploymentRuntimeConfig pins the provider controller to the AMD64
`server-00` control-plane node and has no accelerator request. Crossplane
resolves the package through the internal HTTPS registry route, while the
runtime image is explicitly pinned to the node-registered
`110.120.0.3:30670` endpoint because K3s containerd pulls images from the node
and cannot resolve `*.svc.cluster.local`. It does not schedule anything on
`gpu-server-00`.

## Apply order and current state

1. Apply `../foundation/kustomization.yaml`. This is control-plane-only and
   does not install the provider or create an XR.
2. The provider package is already mirrored and digest-verified; review the
   generated provider RBAC, then apply the Provider and confirm
   `Installed=True` and `Healthy=True` without any Pending Pod or NPU request.
   **Completed 2026-08-19.**
3. Apply the namespaced ProviderConfig and verify `SelfSubjectRulesReview`
   for the provider identity. The target workload API test must allow only the
   `model-serving` namespaced resources; the generated control-plane role is
   audited separately.
   **Completed 2026-08-19.**
4. Install the Composition and render a stopped XR. At this point the
   expected objects are only the cache PVC, zero-NPU cache Job, stopped
   RayService and stable Service/NetworkPolicy; do not create the PVC or Job
   on `gpu-server-00` during this repository phase.

Any package, digest, StorageClass or Artifact Keeper reader Secret mismatch is
a hard stop.  No Secret values are represented here.
