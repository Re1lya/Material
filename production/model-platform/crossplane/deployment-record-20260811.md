# Crossplane production deployment record

## Outcome

Crossplane Core `2.3.4` is deployed in the production K3s cluster in namespace
`crossplane-system`. The release contains one Crossplane Core replica and one
RBAC Manager replica. Both are Ready on `server-00`, have zero restarts, and
run the Linux/AMD64 image from the internal registry by immutable digest.

The namespaced `ModelDeployment` platform API is registered through a
Crossplane v2 XRD and is `Established=True`. This phase creates the API contract
only. There are no `ModelDeployment` instances and no Composition is installed,
so the XRD is intentionally not yet `OFFERED`.

## Released versions and supply chain

| Item | Released value |
|---|---|
| Helm release | `crossplane`, revision 1 |
| Namespace | `crossplane-system` |
| Chart / app | `crossplane-2.3.4` / `2.3.4` |
| Chart SHA256 | `72c349c911a7ba521208538caf9ea48b31974403a64534bc00dae750e2f95b30` |
| Upstream multi-arch index | `sha256:cea30c75198e8cee8e9a4fcb003b158750d345ca91831876de38989c11cbf94c` |
| Linux/AMD64 manifest | `sha256:84d0751cfbdabe2a31a990a4824766ed552893a675c321b7067488d28dccfd26` |
| Runtime image | `110.120.0.3:8889/platform/crossplane:v2.3.4@sha256:84d0751...fd26` |

The direct xpkg image download was too slow. The same multi-architecture index
was found through `docker.1ms.run/crossplane/crossplane:v2.3.4`; its index
digest exactly matched the official xpkg digest. Only the Linux/AMD64 child was
copied to the internal registry. The internal manifest digest and architecture
were checked again after the push and matched the locked values.

## Deployed resource boundary

The Helm render contains:

| Kind | Count |
|---|---:|
| Deployment | 2 |
| Service | 1 |
| ServiceAccount | 2 |
| ClusterRole | 12 |
| ClusterRoleBinding | 3 |
| TLS Secret | 3 |

Crossplane init registered 21 Crossplane core CRDs. No Provider, Function or
Configuration package is installed. The release creates no PVC. Package and
Function caches are bounded disposable `emptyDir` volumes of 20Mi and 512Mi.

Both deployments are pinned to Linux/AMD64 `server-00`. The namespace enforces
the Kubernetes restricted Pod Security profile. Containers run as UID/GID
65532, drop all Linux capabilities, disable privilege escalation, use a
read-only root filesystem, and use the RuntimeDefault seccomp profile.

The RBAC Manager is required for XRD and package RBAC aggregation. Its
cluster-level permissions include role creation, binding and escalation. This
is an intentional privileged control-plane component; package installation and
new XRDs must remain reviewed production changes.

## Resource observations

Declared steady-state requests and limits:

| Component | CPU request / limit | Memory request / limit |
|---|---:|---:|
| Crossplane Core | 100m / 500m | 256Mi / 1Gi |
| RBAC Manager | 100m / 100m | 256Mi / 512Mi |

Initial steady observation was approximately 3m CPU / 161Mi for Core and 2m
CPU / 15Mi for RBAC Manager. After installation the node reported 28.75 CPU
requests (44%) and 51,340Mi memory requests (6%). The large decrease relative
to the earlier Tekton acceptance snapshot came from unrelated workload changes;
Crossplane itself adds exactly 200m CPU and 512Mi memory requests.

## Validation performed

- Source Chart checksum matched the version lock after transfer to the server.
- `helm lint` passed locally and on `server-00`.
- `helm template` was audited for resource kinds, images, storage and security.
- The namespace and all rendered resources passed Kubernetes API server
  dry-run after the empty namespace was created.
- The Helm install used the explicit production kubeconfig
  `/etc/rancher/k3s/k3s.yaml` and completed with `STATUS=deployed`.
- Both Deployments became `1/1 Ready`, with zero restarts.
- Both running image IDs matched the internal Linux/AMD64 digest.
- All 21 Crossplane core CRDs were registered.
- Provider, Function and Configuration queries returned no resources.
- Core and RBAC Manager had no current error, fatal or panic log entries.
- Artifact Keeper, Gitea, Argo CD and Tekton Pods remained Running with zero
  restarts.
- The XRD became `Established=True:WatchingCompositeResource`.
- The generated `ModelDeployment` CRD is namespaced, served and storage-enabled.
- There are zero `ModelDeployment` instances.

## Issue found and resolved

The first XRD revision used `additionalProperties: false` on the nested
`placement` and `access` objects. The XRD itself passed API server dry-run, but
Crossplane rejected the generated composite CRD because this v2 structural
schema path treats explicit `properties` and `additionalProperties` as mutually
exclusive. Those two redundant declarations were removed, the XRD was updated,
and it then became Established.

Another important safety finding is that the `admin` user's default
`kubectl`/Helm context on `server-00` points to the old
`kind-kind-platform-poc-2` cluster. Every production Helm command must therefore
use `--kubeconfig /etc/rancher/k3s/k3s.yaml`; production kubectl checks must use
`sudo k3s kubectl` or the same explicit kubeconfig. Bare `helm` or `kubectl`
commands are unsafe for production work.

## Current intentional limitations

- No Composition or Composition Function is installed.
- The XRD is Established but not Offered.
- No KubeRay, Volcano, NPU, cache Job, PVC or model runtime workload is managed
  by Crossplane.
- No Argo CD Application manages the Crossplane files yet.
- No Tekton validation has been added for Crossplane schemas or references yet.
- Metrics annotations are enabled, but dedicated Prometheus discovery has not
  been accepted as complete.

The next phase should pin and mirror the Composition Function, define the
Pipeline-mode Composition, add ModelVersion and ModelRuntimeProfile schema and
reference checks, and validate rendering without creating a real XR. Only after
that review should the Gitea/Argo CD path manage these resources.
