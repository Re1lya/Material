# Tekton production deployment record — 2026-08-11

## Current production recheck — 2026-08-14

This section supersedes the original acceptance snapshot where the facts have
since advanced; the original installation evidence below is retained for
traceability.

- Tekton Operator, Pipelines, Triggers and both `model-platform-ci`
  EventListeners are Ready on the production K3s cluster.
- The ModelDeployment validator, Gitea PR status writer and GitHub listener are
  deployed. The real Gitea close/reopen delivery path was confirmed, and the
  latest validation PipelineRun `model-platform-config-validation-qhz2f`
  succeeded.
- Current run history contains 9 terminal PipelineRuns (6 `Succeeded`, 3
  historical `Failed`) and 14 terminal TaskRuns (11 succeeded, 3 failures in
  the old report-status Step). The failed runs reached clone/validation; they
  are retained as evidence and were not deleted during this recheck.
- `model-platform-ci/artifact-keeper-image-pull` is a namespace-local
  `kubernetes.io/dockerconfigjson` Secret created out of band for the
  Artifact Keeper `container-images` repository. The live CI image is now the
  Artifact Keeper digest below; the previous 8889 digest remains the rollback
  reference.
- All CI paths remain NPU-free: no TaskRun requests an Ascend resource, creates
  a model runtime, or synchronizes Argo CD.

## Credential and migration preparation — 2026-08-17

- A new repository-scoped read-only `ci-images-reader` token was entered
  interactively and used to replace the existing
  `model-platform-ci/artifact-keeper-image-pull` Secret. Only Secret type and
  key names were inspected; the token value was not read back or recorded.
- Local Material manifests point all four CI image steps at the identical
  Artifact Keeper digest and add the pull Secret to Trigger-generated
  PipelineRuns. The installed Tekton CRD does not support a Pipeline-level
  `spec.taskRunTemplate`, so the source manifest intentionally keeps the
  injection only where Tekton accepts it; manual Runs provide the same template
  explicitly.
- A temporary pull Pod on `server-00` then completed with
  `artifact_keeper_pull=PASS`, used only `10m CPU/16Mi memory`, declared no
  Ascend resource, and was deleted. The two existing Listener Pods remained
  Running and the cluster had no Pending Pods before or after the test.

## Event-based Pruner enablement and strict placement check — 2026-08-17

The singleton `TektonPruner/pruner` was enabled with a namespace-scoped
retention policy for `model-platform-ci`: terminal runs expire after 7 days,
with a history limit of 10 successful and 10 failed runs. The old Job/CronJob
Pruner is absent. No Results backend, model cache, image builder or NPU Task
was enabled by this change.

The first Operator reconciliation exposed a safety issue: the standalone
Operator v0.81 `TektonPruner` resource did not propagate its requested
`nodeSelector` or image override into the generated `TektonInstallerSet`, so
the default Pruner Pods attempted to schedule on `gpu-server-00`/
`gpu-server-05` and referenced GHCR. They were Pending/ContainerCreating and
had no accelerator request. The generated Pruner resources were stopped and
removed before becoming Ready; no existing CI, model or NPU workload was
deleted, scaled or rolled.

The controller and webhook manifests were then fetched through
`ghcr.dockerproxy.net`, verified as the locked linux/amd64 digests, and copied
to the existing internal registry:

```text
110.120.0.3:8889/platform/tekton-pruner-controller:v0.4.1
  sha256:fdf683105a9ad0501cc855967a9ba8f7b5a1d38835d519f3075a2b8cb2fa506a
110.120.0.3:8889/platform/tekton-pruner-webhook:v0.4.1
  sha256:d286f3a294df96a0662008145e5904d808c22b6a3e770b151326116ec441f308
```

The generated InstallerSet was patched with a node selector for
`kubernetes.io/hostname=server-00` and those immutable images. Final live
evidence:

```text
TektonPruner/pruner Ready=True
Pruner Pods: 2 Running, both server-00, both internal 8889 digest-pinned
Pruner Pods on gpu-*     = 0
cluster Pending Pods      = 0
legacy Pruner CronJobs    = 0
model-platform-ci: two EventListeners Ready; retained validation Run unchanged
```

This is a temporary registry exception because an Artifact Keeper writer
credential was not available during the no-GHCR emergency-safe rollout. Before
the next Operator upgrade, mirror these exact manifests to
`110.120.0.3:30670/container-images`, configure the Operator's
`IMAGE_PRUNER_CONTROLLER` and `IMAGE_PRUNER_WEBHOOK` environment variables,
then repeat the node/image/Pending checks. Until then, reapplying or upgrading
the Pruner must include the generated InstallerSet patch from
`pruner-installer-patch.json`.

## FastAPI deployment and CI/CD planning recheck — 2026-08-17

This is a read-only production observation plus an implementation plan, not a
FastAPI deployment record. No object was created, changed, restarted or
deleted during this recheck.

Observed facts:

- no Deployment, StatefulSet, Service, Ingress or HTTPRoute name contains
  `fastapi`, and no dedicated FastAPI namespace exists;
- `server-00` is `linux/amd64` with 64 allocatable CPU; scheduled requests are
  29.7 CPU (46%) and 53132Mi memory (6%), while the point-in-time Metrics API
  sample was 4393m CPU and 76490Mi memory;
- `/mnt/data` is 76% used with about 1.6TiB available;
- `model-platform-ci` is deliberately small: quota 2 CPU/2Gi requests, 4
  CPU/4Gi limits and 10 Pods. It currently has two Running EventListeners and
  one completed Task Pod counted against quota;
- the namespace also contains the paused track's 100Gi RWO
  `ora-desktop-cache`; it is not available to FastAPI;
- the only installed Pipeline remains `validate-model-platform-config`, and
  the only EventListeners are `model-platform-config` and
  `model-platform-github`;
- Tekton Pruner is Ready, but its retention configuration names only
  `model-platform-ci`;
- Argo CD has only `model-platform-bootstrap`, currently Synced/Healthy, and
  continues to use manual synchronization without prune or self-heal;
- Artifact Keeper, Gitea, Argo CD, Backstage and the inspected Tekton control
  Pods were Running with zero restarts.

These facts reject two earlier planning assumptions: FastAPI must not be added
to the existing small model-validation namespace, and a large persistent cache
must not be allocated before measurements. The accepted design direction is:

1. a separate `fastapi-ci` namespace with its own quota, default-deny policy,
   signed repository-specific listener, tokenless test identity, trusted
   publisher identity and one-run concurrency;
2. exact-SHA fresh checkout, frozen lock-file installation, lint/type/unit
   tests and optional bounded integration tests, with status written to the
   exact commit by a separate final Task;
3. no dependency-cache PVC initially; introduce a lock-hash-keyed bounded
   package cache only if cold/warm measurements justify its disk and trust
   cost;
4. a trusted main/tag image lane that never mounts the host Docker/containerd
   socket, publishes only to Artifact Keeper `container-images`, verifies the
   remote AMD64 digest, emits an SBOM/scan report and opens a digest-only GitOps
   PR;
5. a separate `fastapi` runtime namespace, initially one bounded replica pinned
   to validated `server-00`, using a read-only image pull Secret, non-root
   restricted security, startup/readiness/liveness probes and no accelerator
   resource or scheduling field;
6. a dedicated least-privilege Argo AppProject/Application with manual sync,
   prune and self-heal disabled. Tekton receives no Kubernetes deployment or
   Argo credential;
7. database migrations, cache PVC, a second replica/HPA, external routing and
   automated promotion remain separate evidence-driven gates.

The detailed release units, initial planning budgets, trust separation,
rollback sequence and acceptance gates are maintained in `README.md` under
“FastAPI service deployment and CI/CD track”. Before production manifests are
created, the exact FastAPI repository, default branch, lock file, Python
version, test commands, health endpoints and GitOps path must be confirmed.

## Live CI image migration and validation — 2026-08-17

- A server-side dry-run accepted the four image changes and the
  `TriggerTemplate.spec.resourcetemplates[0].spec.taskRunTemplate.podTemplate.imagePullSecrets`
  addition. No Deployment, Listener, Operator, PVC, Secret or NPU object was
  changed.
- Production `Pipeline/validate-model-platform-config` was patched so its
  three validation Steps and Gitea status-finally Step use:

  ```text
  110.120.0.3:30670/container-images/model-platform-ci-tools:v0.2.0@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd
  ```

- `TriggerTemplate/model-platform-config-validation` retained its existing
  `server-00`/amd64 selector and restricted security context while gaining the
  Artifact Keeper pull Secret.
- Manual validation Run
  `model-platform-config-ak-migration-20260817` checked commit
  `1295588d5a5a53262e47140c5f4a0de1b45c544b`. The validation Task and final
  Gitea status Task both succeeded; the final log contained
  `gitea_commit_status=success`, and the final Pod imageID matched the Artifact
  Keeper digest. The Run requested no Ascend resource and ran only on
  `server-00`.
- The first completed validation Pod was deleted after success to release the
  namespace quota; it was the new Run's Pod only. This exposed a retention risk:
  the `model-platform-ci` quota counts completed Pods, so concurrent Runs can
  block the final status Task until completed Pods are pruned.

## Outcome

The first production Tekton control plane and Gitea-triggered CI loop are
deployed on the existing `server-00` K3s cluster. The accepted path is:

```text
Gitea main push
  -> cluster-internal webhook
  -> Tekton EventListener + CEL filter
  -> PipelineRun at the exact 40-character Git commit
  -> read-only clone
  -> Kustomize render and bootstrap structure validation
```

Both a manually created PipelineRun and a Gitea webhook-created PipelineRun
completed with `Succeeded=True` and `bootstrap_validation=PASS`. This stage
does not build or publish images, synchronize Argo CD, write Git, download
models, create PVCs, or request NPU resources.

## Released versions

| Component | Version | Deployment form |
|---|---:|---|
| Tekton Operator | `v0.81.0` | two Deployments in `tekton-operator` |
| Tekton Pipelines | `v1.15.0` | `TektonPipeline/pipeline` |
| Tekton Triggers | `v0.37.0` | `TektonTrigger/trigger` |
| CI tools | `v0.2.0` | Artifact Keeper image pinned by digest |
| Event-based Pruner | Operator `v0.81.0` / Pruner `v0.4.1` | singleton `TektonPruner/pruner`, internal 8889 temporary image mirror |

`TektonPipeline/pipeline`, `TektonTrigger/trigger` and `TektonPruner/pruner`
report `Ready=True`. Remote resolvers remain scaled to zero. Results, Chains,
Dashboard and Pipelines-as-Code were not installed.

## Namespace and scheduling boundaries

Four namespaces are retained because they have different ownership and
security boundaries:

- `tekton-operator`: Operator lifecycle and admission webhook.
- `tekton-pipelines`: Pipeline and Trigger controllers, webhooks and the CEL
  interceptor.
- `tekton-pipelines-resolvers`: reserved by the component installation;
  remote resolvers are disabled.
- `model-platform-ci`: application CI objects, listener and run history.

All steady Pods are pinned to `kubernetes.io/arch=amd64` and
`kubernetes.io/hostname=server-00`. Resource request keys are only `cpu` and
`memory`; no `huawei.com/Ascend910` or other accelerator request exists.

## Image supply chain

The upstream image indexes and their `linux/amd64` child manifests are locked
in `images.lock`. GHCR sources were fetched through
`ghcr.dockerproxy.net`, verified against both locked digests, then pushed to
`110.120.0.3:8889/platform/`. The non-GHCR shell source was fetched directly
from its upstream registry and received the same digest checks.

Seventeen Tekton images and the CI tools image are now internal. A runtime
inspection of all Tekton and CI Pods returned only image references beginning
with `110.120.0.3:8889/`. The mirroring script was rerun after release and
reported all targets already present with the expected digest.

## Operator release details

The verified upstream Operator release installs 14 Operator CRDs and the
cluster RBAC/admission surface required to manage Tekton components. Local
patches enforce internal images, amd64 `server-00` placement, restricted
security contexts and bounded resources.

The upstream manifest defaulted `AUTOINSTALL_COMPONENTS` to `true`. A first
reconciliation therefore created an unwanted broad `TektonConfig/config`.
The release was stopped before the custom component CRs were applied. The
Operator ConfigMap was changed to `AUTOINSTALL_COMPONENTS=false`, the Operator
was rolled, and only the auto-generated `TektonConfig` was removed. Its
finalizers cleaned the transient auto-generated component resources. No CRD
was manually deleted. The intended `TektonPipeline` and `TektonTrigger` CRs
were then applied explicitly.

The generated Operator proxy webhook initially scheduled to an ARM64 node and
failed with `exec format error`. Its component deployment options now enforce
the amd64 `server-00` selector. The replacement Pod became Ready with zero
restarts and no NPU request.

## CI security model

- Gitea user `ci-reader` is a repository-scoped read-only collaborator for
  `gitadmin/model-platform-config`; pull is allowed and push/admin are denied.
- Its token is stored only in Secret `model-platform-ci/gitea-ci-reader`.
- The Runner ServiceAccount has automount of Kubernetes credentials disabled.
- The Listener may read only the required namespaced Trigger/config objects,
  read cluster Trigger definitions, create PipelineRuns, impersonate only the
  named Runner, and emit Events.
- The Listener was deliberately not granted cluster-wide Secret read access.
- Restricted Pod Security labels, ResourceQuota and LimitRange apply to the CI
  namespace.
- Default-deny NetworkPolicies allow only DNS, Kubernetes API access for the
  Listener, Gitea HTTP, Gitea-to-Listener ingress and Listener-to-interceptor
  TLS.
- The webhook is cluster-internal and accepts only a Gitea `push` whose
  repository is `gitadmin/model-platform-config` and ref is
  `refs/heads/main`.

The first stage relies on the cluster-internal source boundary instead of a
shared webhook signature. A signature check is required before exposing the
listener through an ingress or accepting external webhook sources.

## CI validation behavior

The Pipeline requires a complete lowercase 40-character commit ID and checks
out that exact revision in detached mode. It refuses any repository URL other
than the expected internal Gitea repository. Credentials are supplied through
a temporary `GIT_ASKPASS` file and removed after checkout.

The Runner has no Kubernetes API token. It performs an offline validation:

1. render `environments/production/bootstrap` using `kubectl kustomize`;
2. require exactly one object;
3. require the expected ConfigMap name and namespace;
4. print the rendered SHA-256.

Kubernetes server-side admission remains a release-stage check. It is not
silently added to this read-only CI by giving the Runner cluster credentials.

## Problems found during acceptance

| Observation | Root cause | Correction | Result |
|---|---|---|---|
| EventListener waited for informer cache | listener RBAC omitted namespaced Secret discovery and `clustertriggerbindings` | added only the missing scoped reads and restarted the stateless listener | listener Ready; no cluster-wide Secret access |
| first manual run could not execute the repository script | Git file lacked executable mode | invoked validation explicitly instead of relying on mode | checkout path advanced to script compatibility check |
| repository script used Bash features | CI image deliberately contains only POSIX shell | moved the equivalent bootstrap checks into the Pipeline's POSIX script | no new package or image dependency |
| client dry-run attempted OpenAPI/discovery | kubectl apply requires API discovery even when validation is disabled | retained offline Kustomize parsing and structural assertions; server dry-run stays in release gate | tokenless Runner preserved |
| old listener ReplicaSet remained after diagnostic rollout | EventListener controller reconciled the generated Deployment template | deleted only the failed stateless Pod; Deployment converged to one healthy ReplicaSet | one Ready listener, zero restarts |

Failed diagnostic PipelineRuns were deleted after their causes were recorded.
The successful manual and webhook-triggered runs remain as acceptance evidence.

## Acceptance evidence

Manual validation:

```text
PipelineRun: model-platform-config-manual-20260811-5
Commit:      58abbd4bc926ffd3d186f75c924d99dafec4df73
Result:      Succeeded=True
Output:      bootstrap_validation=PASS
```

Automatic validation:

```text
Gitea hook:  repository hook id 1, active, push events, main branch
Test HTTP:   204
PipelineRun: model-platform-config-validation-xrjkm
Commit:      58abbd4bc926ffd3d186f75c924d99dafec4df73
Result:      Succeeded=True
Output:      bootstrap_validation=PASS
```

At final inspection, all Operator, Pipeline, Trigger, interceptor, webhook and
listener Deployments were Ready. Active steady Pods had zero restarts. All
four Tekton/CI namespaces had zero PVCs.

Observed steady consumption was approximately 14m CPU and 277Mi memory. Node
allocated requests changed from the pre-release baseline of about 48.5 CPU /
128396Mi memory to 49.55 CPU (77%) / 129676Mi (16%). CPU limits reached 108%,
which is overcommit rather than a scheduler reservation. The next controller
module must still be budgeted against requests, not limits alone.

Gitea, Argo CD and Artifact Keeper Pods remained Ready with zero restarts.
No workload in their namespaces was rolled or reconfigured by this release.

## Current limitations and next expansion

This is a complete minimal CI loop, not yet a complete model release pipeline.
It proves trusted Git event intake and deterministic validation without using
NPU resources. Normal expansion is an in-place update, not a rebuild:

1. add schema and cross-reference validation for ModelVersion and runtime
   profile objects;
2. add a controlled artifact publication Task with a dedicated write token;
3. add an image build Task only after builder isolation and registry policy are
   approved;
4. keep Argo CD synchronization as a distinct approval/release step;
5. add Tekton Results only after persistence and retention are designed;
   event-based Pruner retention is already enabled for `model-platform-ci`;
6. perform model cache and inference Tasks only during an approved NPU window.

The existing single K3s control plane and single controller replicas can be
expanded in place. K3s control-plane HA is a separate infrastructure change;
it is not required to update Tekton components or add worker-executed Tasks.
