# Tekton production deployment record — 2026-08-11

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
| CI tools | `v0.1.0` | internal image pinned by digest |

`TektonPipeline/pipeline` and `TektonTrigger/trigger` both report
`Ready=True`. Remote resolvers remain scaled to zero. Results, Pruner,
Chains, Dashboard and Pipelines-as-Code were not installed.

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
5. add Results/Pruner only after persistence and retention are designed;
6. perform model cache and inference Tasks only during an approved NPU window.

The existing single K3s control plane and single controller replicas can be
expanded in place. K3s control-plane HA is a separate infrastructure change;
it is not required to update Tekton components or add worker-executed Tasks.
