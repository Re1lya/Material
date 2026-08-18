# Tekton production bootstrap

This directory prepares the first production CI control plane for the model
platform. It is intentionally NPU-free and does not build images, download
models, write Git content, or ask Argo CD to synchronize. Its first job is
narrower: receive a trusted Gitea or GitHub event, clone that exact commit, and
run the repository's bootstrap/catalog/ModelDeployment policy validation.

The ModelDeployment validator now has a bounded Qwen3.8 BF16-to-W8A8 branch:
when the allow-listed ModelScope model reference appears, it requires the
Composition, `gpu-server-00`/910B3 placement, Artifact Keeper digest-pinned
runtime/cache images, 8-device worker contract, immutable manifest/path match
with the catalog, ModelSlim provenance (`sourcePrecision=bf16`, `target=w8a8`),
and the `Stopped=0` / `Running=1` worker gate. It never downloads model bytes,
reads Artifact Keeper tokens, creates Kubernetes objects, or schedules an NPU
Pod. The actual ModelSlim quantization is an isolated artifact-build step
before the catalog PR, not a Tekton validation step.

## What "single replica" means

This does not create another Kubernetes cluster. Tekton is installed into the
existing K3s cluster. `single replica` means that each Tekton controller,
webhook, interceptor, and EventListener has one Pod. Those Pods are pinned to
the existing amd64 management node `server-00`; PipelineRun Task Pods are also
pinned there for this first stage.

The platform can be expanded by updating the Operator custom resources and
the CI manifests. Adding replicas, Results, Chains, another listener, or
worker-node Task placement is an in-place reconciliation, not a rebuild.
Making the K3s control plane itself highly available is a separate K3s change
and is not performed here.

## Components

- Tekton Operator `v0.81.0` owns installation and later component upgrades.
- Tekton Pipelines `v1.15.0` reconciles PipelineRuns into TaskRun Pods.
- Tekton Triggers `v0.37.0` turns an accepted Gitea webhook into a PipelineRun.
- The existing Gitea EventListener and CEL interceptor accept a `push` to
  `gitadmin/model-platform-config` on `main`, plus opened/reopened/synchronized
  same-repository pull requests targeting `main`.
- The separate GitHub EventListener verifies the GitHub webhook HMAC before CEL
  accepts a `push` to `Re1lya/Material` on `main`, or an opened, reopened, or
  synchronized same-repository pull request targeting `main`.
- `model-platform-ci` isolates the listener, Pipeline, ServiceAccounts,
  ResourceQuota, LimitRange, and NetworkPolicies.
- The Operator event-based `TektonPruner/pruner` removes only terminal
  PipelineRuns/TaskRuns in `model-platform-ci` after seven days and keeps at
  most ten successful and ten failed records. It is not an additional
  old-style Pruner CronJob.
- The deployed `model-platform-ci-tools:v0.2.0` combines pinned internal
  Python/kubectl content, Git and the locked schema validator. The Pipeline uses
  those tools without mounting a Kubernetes API token.

The Operator is used deliberately: component versions and optional additions
remain declarative and upgradable. Its cost is a wider cluster-level surface:
the upstream release installs 14 Operator CRDs plus the RBAC needed to manage
Tekton component CRDs, admission webhooks, and controllers. Only
`TektonPipeline` and `TektonTrigger` instances are created in this stage.

## Steady resource envelope

The original Gitea-only steady state was approximately 10 small Pods and 1.1
CPU / 1.3 GiB of requests, including the EventListener and Operator proxy
webhook. The second EventListener adds one Pod with 100m CPU / 128 MiB requests
and 500m CPU / 512 MiB limits. Limits do not reserve CPU. A validation
PipelineRun is on demand. The main Task runs sequential 250m/256Mi,
250m/256Mi and 100m/128Mi validation Steps, then one 100m/128Mi Gitea status
Step. No new PVC is created by this config-validation path.

Remote resolvers are disabled and their Deployment is scaled to zero. Results,
Chains, Dashboard, Pipelines-as-Code, model cache, image build, and NPU tasks
are outside this stage. Pruner is enabled only for the retention policy above.

## Files and ownership

- `versions.lock.yaml` freezes upstream release URLs and SHA-256 hashes.
- `images.lock` maps immutable upstream images to the internal registry.
- `mirror-images.sh` verifies each upstream multi-architecture index digest,
  resolves the locked `linux/amd64` child manifest, then uses Docker to pull
  that platform and push it into the internal registry. Existing targets with
  the correct digest are skipped. `GHCR_PROXY_HOST` may select a transport
  mirror such as `ghcr.dockerproxy.net`; both the index and amd64 child digests
  must still match `images.lock` before any pull, and the pushed target digest
  is verified again.
- `operator/` vendors the verified upstream Operator manifest and applies
  local image, scheduling, resource, and Pod Security patches.
- `system-namespaces.yaml` and `components.yaml` define the Pipeline and
  Trigger installation without a broad `TektonConfig` profile.
- `pruner.yaml` defines the singleton event-based Pruner policy. The current
  Operator v0.81 standalone reconciler does not propagate its image or
  `config.nodeSelector` into the generated InstallerSet, so
  `pruner-installer-patch.json` is applied to that generated object and must be
  rechecked after every Operator/Pruner reconciliation.
- `ci/` defines the constrained validation loop.
- `ci-tools/` builds the validation image.

Production now runs CI image
`110.120.0.3:30670/container-images/model-platform-ci-tools:v0.2.0@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd`.
The additional PR trigger, ModelDeployment validator and status-finally changes
are now deployed and have been exercised by the Gitea PR path. A repository-
scoped read-only Secret named `artifact-keeper-image-pull` exists in
`model-platform-ci`; the live Pipeline is constrained to `server-00`, whose
authenticated Artifact Keeper pull path was verified before this migration.

Production recheck on 2026-08-17 found two Ready EventListeners and nine
historical terminal PipelineRuns. The Artifact Keeper migration validation
`model-platform-config-ak-migration-20260817` completed with both validation
and Gitea status-report Tasks `Succeeded`; its report Pod used the expected
Artifact Keeper imageID. The completed validation Pod was removed afterward
because the namespace ResourceQuota counts completed Pods; no pre-existing
Listener or application Pod was removed.

## Event-based Pruner acceptance — 2026-08-17

The singleton `TektonPruner/pruner` is `Ready=True` and its generated
controller and webhook are both pinned to `server-00`. The retention ConfigMap
contains only the `model-platform-ci` policy:

```text
ttlSecondsAfterFinished: 604800
successfulHistoryLimit: 10
failedHistoryLimit: 10
```

The Operator initially rendered the Pruner images from GHCR and omitted the
node selector. The rollout was stopped before any Pruner Pod became Ready on a
GPU/NPU node. The exact `linux/amd64` controller and webhook manifests were
verified through `ghcr.dockerproxy.net`, copied to the existing internal
`110.120.0.3:8889/platform/` registry, and pinned by digest. The generated
`TektonInstallerSet` was then patched using `pruner-installer-patch.json`.
No active Pruner Pod has an Ascend request; final checks returned zero Pruner
Pods on `gpu-*`, zero cluster Pending Pods and zero legacy Pruner CronJobs.
The two CI EventListeners and the retained successful validation Run stayed
Ready throughout.

This is a temporary registry exception: the current Artifact Keeper writer
credential was not available during the no-GHCR rollout, so these two new
Operator images are in 8889. Before the next Operator upgrade, mirror the same
digests to `110.120.0.3:30670/container-images`, update the InstallerSet patch
and pull policy, then repeat the no-GPU verification. The Operator-level
hardening target is to configure `IMAGE_PRUNER_CONTROLLER` and
`IMAGE_PRUNER_WEBHOOK` in `operator/operator-patch.yaml`; do that in a planned
reconciliation window rather than changing the live Operator casually.

To reproduce the safe release sequence, first apply `pruner.yaml` with a
server-side dry-run, wait for the singleton `pruner` resource, locate the
generated InstallerSet, apply the JSON patch, and verify every generated Pod's
node and image before considering the Pruner enabled:

```bash
sudo k3s kubectl apply --dry-run=server -f pruner.yaml
sudo k3s kubectl apply -f pruner.yaml
sudo k3s kubectl get tektoninstallerset -o name | grep pruner-main-deployment
sudo k3s kubectl patch tektoninstallerset <generated-name> --type=json \
  --patch-file pruner-installer-patch.json
sudo k3s kubectl -n tekton-pipelines get pods \
  -l app.kubernetes.io/part-of=tekton-pruner -o wide
```

If any generated Pruner Pod targets `gpu-*`, or an image reference is not an
approved internal digest, stop and scale/delete only the new Pruner resources;
do not touch existing model, NPU or CI workloads. The official retention and
scope semantics are described in [Tekton Pruner documentation](https://tekton.dev/docs/pruner/)
and the Operator CR in [TektonPruner documentation](https://tekton.dev/vault/operator-main/tektonpruner/).

## FastAPI service deployment and CI/CD track

### Observed production baseline (read-only, 2026-08-17)

This track has been reactivated for design and documentation only. A read-only
production inspection found no Kubernetes Deployment, StatefulSet, Service,
Ingress or HTTPRoute whose name contains `fastapi`, and no dedicated FastAPI
namespace. Therefore the old Kind POC and `fastapi-demo-2` references are
historical evidence only; they are not a production deployment baseline.

The production constraints that drive the design are:

| Constraint | Observed value | Design consequence |
|---|---|---|
| Production node | `server-00`, `linux/amd64`, 64 allocatable CPU | Build and runtime images must be AMD64 and initially pinned to this node |
| Scheduled requests | 29.7 CPU (46%), 53132Mi memory (6%) | Start with one bounded runtime replica and one CI run at a time; remeasure before release |
| Point-in-time usage | 4393m CPU (6%), 76490Mi memory (9%) | Usage is not a reservation; requests remain the scheduling gate |
| `/mnt/data` | 7.0TiB total, 1.6TiB available, 76% used | Do not allocate a new large cache PVC before cold-run measurements |
| Existing CI quota | `model-platform-ci`: 2 CPU/2Gi requests, 10 Pods | Do not add FastAPI builds to this namespace or raise its quota implicitly |
| Existing CI storage | 100Gi RWO `ora-desktop-cache`, track paused | Do not reuse or delete this PVC for FastAPI |
| Artifact Keeper pulls | `server-00` is validated for `30670`; other workers are not | Pin all first-release Pods to `server-00` and use namespace-local read-only pull Secrets |
| Argo CD | one manually synchronized Application; prune/self-heal disabled | Keep FastAPI CD manual and create a separate least-privilege AppProject/Application |
| Tekton Pruner | retention is configured only for `model-platform-ci` | Add `fastapi-ci` retention explicitly; do not assume it is inherited |

The existing model validation Pipeline and its two EventListeners remain
unchanged. FastAPI is a normal CPU-only application and must not use the
`model-serving` namespace, model cache, Ray/KubeRay, accelerator node selectors
or any accelerator resource key.

### Release units and ownership

Use two new namespaces and keep four release units independently reviewable:

| Release unit | Namespace | Owns | Must not own |
|---|---|---|---|
| FastAPI CI intake/test/build | `fastapi-ci` | EventListener, Trigger, Pipeline, tokenless test SA, trusted publisher SA, quotas and NetworkPolicies | Argo sync, runtime Deployment, model/NPU objects |
| FastAPI runtime | `fastapi` | Deployment, Service, optional HTTPRoute/Ingress, runtime NetworkPolicy and read-only image pull Secret reference | Tekton controllers, cluster-wide RBAC |
| GitOps policy | `argocd` | dedicated `fastapi` AppProject/Application with one repository/path/namespace allow-list | automated sync, prune, self-heal, cluster-scoped resources |
| Image repository | Artifact Keeper `container-images` | immutable AMD64 application image, build-cache objects, SBOM and scan metadata | mutable production image selection |

Do not put CI and runtime into `model-platform-ci`; its quota and retention are
already tuned for lightweight model-policy validation. Do not share the paused
`ora-desktop-cache` PVC. The FastAPI source repository, default branch, lock
file, Python version, health endpoints and GitOps path must be frozen before
any manifest is rendered; no placeholder value may be applied to production.

### PR CI lane: automatic, unprivileged and deterministic

```text
signed same-repository PR webhook
  -> repository/action/base-branch filter
  -> deduplicate delivery and require a 40-character head SHA
  -> report pending on that exact SHA
  -> fresh emptyDir checkout, shallow fetch of the exact SHA
  -> uv sync --frozen (or equivalent lock-enforcing install)
  -> ruff check + format --check
  -> configured type check
  -> pytest unit tests
  -> optional bounded integration tests
  -> always report success/failure/error on the same SHA
```

Security and resource rules:

- use a dedicated EventListener and repository allow-list; do not broaden the
  Material/Gitea trigger;
- initially accept only trusted pushes and same-repository PRs; reject forks
  before a PipelineRun is created;
- the test ServiceAccount has `automountServiceAccountToken: false`, receives
  no Registry writer, Git writer or deployment credential, and cannot contact
  the Kubernetes API;
- use a fresh `emptyDir` checkout for every run and verify `HEAD` equals the
  webhook SHA; never test a moving branch or persistent worktree;
- install only from the committed lock file with hashes/frozen mode; fail when
  the lock and project metadata disagree;
- keep lint, type and unit test Steps in one Task Pod so the source workspace
  is not copied between Pods; put status reporting in a separate `finally`
  Task that never executes repository code;
- set Pipeline and Step timeouts, `activeDeadlineSeconds`, retry only
  infrastructure failures, and start with one concurrent PipelineRun;
- begin with a namespace envelope of 2 CPU/4Gi requests, 4 CPU/8Gi limits and
  10 Pods, then right-size from cold/warm measurements. This is a proposed
  ceiling, not permission to apply a ResourceQuota without review;
- default-deny ingress/egress; allow DNS, the approved Git endpoint, approved
  dependency endpoint/proxy and the status API only. An EventListener does not
  inherit build credentials or unrestricted build egress.

Do not create a dependency-cache PVC in the first release. Measure checkout,
locked install, network bytes and total duration first. If dependency download
is material, add a separate bounded RWO cache only after disk review, keyed by
Python version, lock-file hash and package-manager version. Cache package
artifacts only; never cache a mutable checkout, virtual environment, installed
application tree or test result across PR trust boundaries.

### Main/tag image lane: trusted publisher separated from PR code

Only an accepted main commit or release tag may enter the publisher lane:

```text
verified main/tag SHA
  -> rerun the locked checks at that SHA
  -> build without a host Docker socket
  -> produce OCI image + SBOM + vulnerability report
  -> push tag to 110.120.0.3:30670/container-images
  -> resolve and verify the remote linux/amd64 digest
  -> trusted promoter opens a narrow GitOps PR changing only image digest
```

The builder must be an approved rootless, digest-pinned BuildKit-compatible
image or an explicitly identified external build host. Never mount
`/var/run/docker.sock`, containerd sockets, the host root or a broad Kubernetes
credential into a Task. A rootless builder is not accepted merely because it
starts: its Pod Security settings, network policy, ephemeral-storage bound and
push/pull behavior must pass server-side dry-run and one disposable build.

Use multi-stage builds with a locked Python base and dependencies. The runtime
image contains only the application and runtime dependencies, runs as a numeric
non-root UID/GID, drops all capabilities, uses a read-only root filesystem and
writes only to bounded `/tmp`/application `emptyDir` mounts. Set OCI source and
revision labels. Artifact Keeper's optional scanning stack is disabled in the
current production profile, so CI must generate the SBOM and scan evidence; do
not claim that Registry upload itself performed a security scan.

Registry writer and GitOps writer credentials are mounted only in trusted
publisher/promoter Steps that do not execute PR-controlled scripts. The
promoter may create a branch and PR changing one approved image field; it may
not push to main, merge, call Kubernetes or invoke Argo CD. Production YAML
must use `image@sha256:<digest>`; a mutable tag alone is never promoted.

### Runtime deployment profile

The first runtime release is deliberately small and reversible:

- one replica on `kubernetes.io/hostname=server-00`, with a starting request of
  `100m CPU/256Mi` and limit of `1 CPU/512Mi`; adjust these planning values from
  load-test evidence before applying them;
- `RollingUpdate` with `maxSurge: 0` and `maxUnavailable: 1` to avoid temporary
  double reservation on the shared node; the accepted trade-off is a brief
  maintenance window for the first single-replica release;
- dedicated tokenless ServiceAccount, restricted Pod security context,
  `terminationGracePeriodSeconds` and ASGI graceful shutdown;
- startup probe for slow initialization, readiness probe for dependency
  readiness and liveness probe for process health. `/readyz` must fail when the
  instance cannot safely receive traffic; `/healthz` must not run expensive
  dependency checks;
- ClusterIP Service first. Add an HTTPRoute/Ingress only after the exact host,
  TLS certificate and authentication/rate-limit boundary are approved; do not
  create another public NodePort;
- default-deny NetworkPolicy with only DNS and explicit application
  dependencies. Database credentials remain an out-of-band namespace Secret,
  never a ConfigMap or committed manifest;
- no HPA or second replica until CPU/memory/request latency and application
  statelessness are measured. Add a PodDisruptionBudget only when at least two
  replicas can actually be scheduled.

If schema migration is required, use the same image digest in a separately
reviewed, idempotent, bounded Job with `backoffLimit`, deadline and explicit
database credentials. Run and verify it before changing the Deployment. Do
not hide a long or irreversible migration in container startup or an automatic
Argo hook; document backward compatibility and rollback before release.

### CD lane and rollback

```text
reviewed digest-only GitOps PR merged
  -> Argo CD reports OutOfSync
  -> inspect render/diff and run API-server dry-run
  -> human initiates sync with prune=false
  -> wait for probes and verify Service from inside the cluster
  -> verify bounded application errors and existing control-plane restarts
  -> record accepted Git SHA, image digest and rollout revision
```

Create a dedicated AppProject that permits only the exact Gitea repository,
the exact FastAPI path, namespace `fastapi`, and the required namespaced kinds.
The Application has no automated policy and no deletion finalizer in the first
release. Tekton never runs `kubectl` and never calls Argo CD.

Rollback restores the previous accepted image digest and configuration revision
through another reviewed Git change and manual sync. Do not delete Registry
tags or roll back a database schema blindly. A failed probe stops acceptance;
collect status and bounded logs before deciding whether a workload rollback or
forward fix is safer.

### Phased deployment gates

1. Freeze the source repository, branch/tag policy, Python/tool versions,
   committed lock, test commands, health contract, dependency endpoints and
   GitOps destination.
2. Locally render and validate namespace, quota, RBAC, NetworkPolicy, Trigger
   and Pipeline. Confirm every image digest, resource request and absence of
   accelerator keys, PVCs and host sockets.
3. Apply only the `fastapi-ci` intake/test lane after server-side dry-run; run
   one success and one deliberate failure at exact SHAs and verify status.
4. Approve and test one isolated builder, publish an AMD64 image by digest,
   SBOM and scan report, then confirm PR jobs cannot access publisher secrets.
5. Create the runtime namespace and pull Secret out of band, server-dry-run the
   runtime manifests, and perform one manual Argo sync with prune/self-heal off.
6. Verify probes, internal request, resource usage, graceful termination,
   digest rollback and zero unexpected restarts in existing control-plane
   namespaces.
7. Only after measurements, decide separately on cache PVC, second replica,
   HPA, external route or automated promotion. None is implied by the first
   release.

Extending Tekton Pruner to `fastapi-ci` is part of the CI release and must use
a namespace-specific retention entry. Recheck the generated InstallerSet node
selector and internal images after that Operator reconciliation. This change
must not alter the existing `model-platform-ci` seven-day/10-success/10-failure
policy.

## Trust and access boundaries

- The live Pipeline and TriggerTemplate use the immutable
  `110.120.0.3:30670/container-images` digest. The namespace-local
  `artifact-keeper-image-pull` Secret is read-only and is injected into
  Trigger-created PipelineRuns. The first-stage TriggerTemplate and manual
  validation Run remain pinned to amd64 `server-00`; other nodes are not yet
  eligible consumers. The previous 8889 digest remains available for rollback.
- `model-platform-ci` has a small ResourceQuota. Completed Task Pods count
  toward it until the event-based Pruner removes them after seven days; the
  history limits above still bound retained records. A quota/retention review
  is required before running many concurrent PipelineRuns.
- The Gitea reader token is created out of band as Secret
  `model-platform-ci/gitea-ci-reader`; no credential belongs in Git.
- The separate `gitea-ci-status-writer` Secret contains only a
  repository-scoped token for commit status writes. It is mounted solely into
  the final status Step and cannot alter repository content or merge a PR.
- The GitHub webhook HMAC is created out of band as Secret
  `model-platform-ci/github-webhook-secret`, key `secretToken`. It is not a
  GitHub API token and is never passed to a PipelineRun.
- GitHub clone support currently targets the public
  `https://github.com/Re1lya/Material.git` repository and needs no clone token.
  Fork pull requests are deliberately rejected; adding them requires a
  separate untrusted-code policy.
- The runner ServiceAccount does not mount a Kubernetes API token.
- The listener can read only its Trigger objects, impersonate only the runner,
  create PipelineRuns, and read the cluster-wide CEL interceptor definition.
- NetworkPolicy permits DNS, the Kubernetes API, Gitea HTTP, the Gitea-to-
  listener request, and listener-to-interceptor TLS. Other ingress and egress
  are denied.
- The Gitea source remains restricted by NetworkPolicy. The GitHub listener
  verifies every accepted event with Tekton's GitHub interceptor and a shared
  HMAC before repository and branch filtering.
- GitHub PipelineRun Pods alone receive external TCP/443 egress for cloning;
  private, loopback, link-local and multicast address ranges remain excluded.
- The Gitea PR path rejects forks, checks a full 40-character head SHA, enforces
  the stopped/control-plane-only schema and reports
  `tekton/model-platform-policy` success/failure to that exact SHA. The real
  Gitea close/reopen delivery path has been confirmed in production; the latest
  synthetic PR validation is successful.
- Windows Task execution is unsupported. The Operator's Windows shell image
  setting intentionally points at the pinned Linux shell because this cluster
  contains no Windows nodes.

## Release sequence and gates

Production writes are separated into explicit gates:

1. Mirror the locked upstream images, build the CI tools image, record its
   digest, and render again. This writes only to the existing registry.
2. Apply the Operator manifest. This creates the `tekton-operator` namespace,
   14 CRDs, cluster-scoped RBAC, admission webhooks, and two Operator Pods.
3. Wait for Operator readiness, apply the system namespaces and component CRs,
   and wait for Pipeline and Trigger readiness.
4. Server-side dry-run the CI resources now that their CRDs exist.
5. Provision the read-only Gitea account/token Secret, apply the CI resources,
   configure the internal Gitea webhook, and run one non-NPU validation push.
   The production installation has completed this sequence; future changes
   should use the same gates and leave the Task Pods NPU-free.

Any failed gate stops the sequence. CRDs are not deleted during rollback.
Component CRs and CI objects can be removed separately, but CRD deletion is a
distinct destructive operation because it can remove all corresponding custom
resources.

## Expansion path

Normal upgrades update `versions.lock.yaml`, refresh the vendored manifest and
digests, validate the rendered diff, mirror the new images, then apply updated
CRs. Existing PipelineRuns and CI definitions do not require a cluster rebuild.
When workload grows, first move Task Pods to labelled CPU workers, then raise
controller replicas and budgets. Pruner retention is now enabled for the
namespace policy above; any change to its images, node placement or retention
must be reviewed as a separate Operator reconciliation.

## Temporary GitHub ingress with Cloudflare Quick Tunnel

The GitHub EventListener is intentionally a ClusterIP service. For a bounded
integration test, run a local port-forward and Cloudflare Quick Tunnel on
`server-00` rather than adding an unauthenticated NodePort or placeholder
Ingress. This path changes no existing Gitea Service or webhook:

```text
GitHub webhook
  -> random HTTPS trycloudflare.com URL
  -> cloudflared on server-00
  -> localhost port-forward
  -> Service/el-model-platform-github
  -> GitHub HMAC interceptor
  -> CEL repository/event filter
  -> shared validation Pipeline
```

The user starts the two long-running processes in separate terminals:

```bash
sudo k3s kubectl --namespace model-platform-ci port-forward \
  service/el-model-platform-github 18080:8080 \
  --address 127.0.0.1

cloudflared tunnel --url http://127.0.0.1:18080
```

Use the generated `https://<random>.trycloudflare.com/` URL as the GitHub
webhook Payload URL, select `application/json`, enter the same value stored in
`github-webhook-secret/secretToken`, and subscribe only to pushes and pull
requests. Never print or commit that shared value. Both processes must remain
running during the test. A new Quick Tunnel process gets a different URL, so
the GitHub webhook must then be updated.

Quick Tunnel is only an integration aid: it has no uptime guarantee and no
stable hostname. The durable replacement is a named Cloudflare Tunnel with a
reviewed hostname, token Secret, internal-only origin Service, pinned internal
`cloudflared` image, health probes, resource limits, and a dedicated
NetworkPolicy. GitHub status/check reporting remains a separate hardening
phase; the current GitHub listener starts PipelineRuns and the Gitea path writes
the `tekton/model-platform-policy` status. No model runtime or NPU task is
connected to either listener.
