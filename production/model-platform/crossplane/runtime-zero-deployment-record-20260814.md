# Crossplane runtime-zero production deployment record

## Outcome

On 2026-08-14 the production K3s cluster was extended in place from the
Crossplane Core/XRD bootstrap to a usable, deliberately stopped runtime
control path. The release did not replace or scale the existing Qwen
Deployment and did not create a Pod or allocate an NPU.

The resulting production state is:

- Crossplane Helm release revision 2, Core and RBAC Manager Ready;
- Function Patch and Transform `v0.8.2` Installed and Healthy;
- `ModelDeployment` XRD Established and Offered;
- Composition `modeldeployment-runtime-zero-v1alpha1` installed;
- one namespaced `ModelDeployment/qwen36-pd-crossplane-zero` with
  `desiredState: Stopped`, `SYNCED=True` and `READY=True`;
- one composed status ConfigMap, one ClusterIP Service and one Deployment with
  `spec.replicas: 0`;
- no composed Pod, Job, PVC, RayCluster or RayService.

## Artifact Keeper package path

The Function image is owned by the integrated platform and is stored in the
Artifact Keeper Docker repository:

```text
110.120.0.3:30670/container-images/function-patch-and-transform:v0.8.2
sha256:070fd3bdb56ec93f825e2f8fcda902bbdaef2e7831e164be5311144867f51dd8
platform: linux/amd64
```

Crossplane Core cannot use K3s containerd's insecure-registry configuration
when it resolves an xpkg. Therefore Core fetches the package through the
cluster-internal HTTPS name
`artifact-keeper-registry.artifact-keeper.svc.cluster.local`, with a dedicated
internal CA bundle mounted by the Crossplane Helm release. Kubelet/containerd
starts the unpacked Function runtime from the registered node endpoint
`110.120.0.3:30670`, using a read-only pull Secret in `crossplane-system`.

The internal HTTPS route is an ExternalName Service plus Traefik Ingress. It
does not replace or remove the existing Artifact Keeper HTTP NodePort. The CA
private key is not stored in this repository.

## Runtime-zero contract

The Composition copies the reviewed shape of the previous
`pd_1p2d_control_v1` Deployment into a Crossplane-owned dormant template. It
keeps the legacy runtime image digest, existing four ConfigMaps, A3 placement,
model-cache path and service ports, but hard-codes `replicas: 0`.

The generated Deployment advertises the future request of 64 CPU, 256Gi
memory and six `huawei.com/Ascend910` devices. Those values are inert while the
replica count is zero: Kubernetes creates no Pod and performs no scheduling or
device allocation. Crossplane continuously reconciles the Deployment back to
zero. Starting it is intentionally not part of this release and requires a
separate NPU-window review.

The existing Deployment
`infra-learning/ray-vllm-pd-control-pilot-qwen36-27b` remained at zero replicas
before and after the release. It is not adopted, patched or deleted by
Crossplane.

## Issue found and resolved

The Artifact Keeper mirror and HTTPS package download succeeded, but the first
Function runtime Pod stopped at `CreateContainerConfigError`. The image
declares the named user `nonroot:nonroot`; Kubelet cannot prove a named user is
non-root when `runAsNonRoot` is enabled. The DeploymentRuntimeConfig now pins
the standard distroless identity `runAsUser: 65532` and
`runAsGroup: 65532`. The replacement Function Pod became Ready with zero
restarts and the Function condition became Healthy.

## Validation evidence

- Function package digest and architecture were checked after mirroring.
- The internal HTTPS registry returned the expected authenticated `/v2/`
  response with the installed CA.
- Crossplane Helm revision 2 completed successfully with the CA bundle.
- Function and FunctionRevision reported Installed/Healthy/Runtime true.
- RBAC, XRD, Composition and the stopped XR passed API-server dry-run before
  apply.
- The XR reported `Synced=True`, `Ready=True` and `Responsive=True`.
- Composed resources were exactly Deployment, Service and ConfigMap.
- The Deployment reported `0/0`, with `spec.replicas=0` and no ready replica.
- Label queries returned no Pod, Job, PVC, RayCluster or RayService.
- The old Qwen Deployment remained at `spec.replicas=0`.
- The list of existing Qwen/DeepSeek/vLLM Pods was unchanged across the
  release; the unrelated running workload in namespace `ds` was not touched.
- Recent Crossplane Core logs contained no error, panic, forbidden or denied
  entries.

The final `kubectl top` observation was approximately 7m CPU / 185Mi for Core,
1m / 16Mi for RBAC Manager and 0m / 16Mi for the Function. The Function's
declared request is 100m CPU / 128Mi memory; the zero-replica model Deployment
adds no running-Pod consumption.

## Remaining boundary and next step

This is not yet a model-serving activation. The model cache path is referenced
by the dormant Deployment but was not populated or read by this release. The
next safe work is to put the XRD/Composition/XR source under the reviewed
Gitea/Argo manual-sync path and finish catalog/reference validation. Cache
population may follow with zero NPU only after node disk/network approval.
Actual runtime activation and later conversion to RayCluster/RayService remain
separate, NPU-gated upgrades; neither requires rebuilding Crossplane Core or
the catalog.
