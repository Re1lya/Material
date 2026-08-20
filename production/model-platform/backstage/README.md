# Backstage minimum usable integration plan

## Status and goal

Backstage is deployed in production in namespace `backstage` and the portal,
OIDC login, Catalog, read-only Kubernetes view and constrained Gitea PR action
have been accepted. The active image is v0.2.11 at the immutable internal
AMD64 digest recorded in `versions.lock.yaml`. The image is pulled from
Artifact Keeper with the namespace-local repository-scoped read-only Secret
`artifact-keeper-backstage-pull`. The deployment form records bounded
TP/PP/replica/priority intent but always creates a stopped GitOps request;
the effective runtime is selected by the reviewed ModelRuntimeProfile.

The first production Backstage release is intentionally small. It must give a
developer one place to:

- sign in through the configured Gitea OIDC provider as the approved
  `gitadmin` user;
- find the verified Qwen model and current platform services;
- submit one allow-listed, stopped model deployment request as a Gitea branch
  and pull request, including bounded scheduling intent for the Ray contract;
- see Backstage, Crossplane and control-plane-only model request state through
  namespace-scoped Kubernetes reads;
- follow links to Gitea and Artifact Keeper without receiving direct
  Kubernetes write permission.

The current source-level recipe integration reads the allow-listed
`ModelVersion`/`ModelRuntimeProfile` documents from Gitea through a backend
read-only API, reads namespaced `ModelDeployment`/RayService/cache status from
Kubernetes using the Backstage ServiceAccount, and sends the deployment button
to the constrained Scaffolder template. The Scaffolder action resolves the
selected catalog contract again on the backend before creating one stopped
Gitea PR. It never accepts a browser-supplied image, host path, node name or
Kubernetes manifest.

The source-level Recipe release boundary and its Tekton/Argo safety checks are
recorded in `../tekton-argocd-recipe-release-20260819.md`. Production still
needs a new AMD64 Backstage image rollout before this live-catalog behavior is
accepted as deployed.

It is not required to provide HA, TechDocs, full-text search, chat, an internal
artifact uploader, automatic Argo synchronization or direct NPU scheduling in
the first release.

## Responsibility boundary

```text
Developer
   |
   v
Backstage: catalog, forms, status aggregation and links
   |
   +---- read-only ----> GitHub / Gitea / Artifact Keeper / Kubernetes
   |
   `---- request ------> branch + pull request in Gitea
                              |
                              v
                 Tekton validation and policy checks
                              |
                         human review/merge
                              |
                              v
                Argo CD detects desired-state change
                              |
                       human Sync approval
                              |
                              v
              Crossplane Composition -> Kubernetes resources
                              |
                              v
                 cache/runtime status shown in Backstage
```

Backstage is not the source of truth and must not create Pods, PVCs,
RayServices or NPU allocations directly. Gitea holds deployment intent,
Artifact Keeper holds immutable artifacts, Kubernetes holds runtime state, and
GitHub holds the source and PR review state for `ora-space/desktop`.

## Planned unified Gitea and Artifact Keeper onboarding (MVP)

The first implementation is now present locally under
`artifact-management-mvp-20260819.md`. It adds the restricted Artifact Keeper
repository/token page and a Tekton publish-status path, but remains opt-in: the
production Backstage config still leaves the section absent until HTTPS,
namespace-local Secrets and a staging PVC are approved.

The current production image does not yet create Artifact Keeper or Gitea
repositories. It only creates the constrained ModelDeployment PR in the fixed
Gitea repository. The next small integration should make Backstage the single
operator-facing entry point while keeping each system as the source of truth:

```text
Backstage form
  -> backend validation and audit
      -> Artifact Keeper repository API
      -> Gitea repository/project API
      -> Tekton upload or CI PipelineRun
          -> Artifact Keeper stores the bytes
```

The first MVP should provide:

- read-only Artifact Keeper repository/format/quota/usage status;
- a bounded `Create artifact repository` form for approved formats
  (`generic`, `huggingface` and `docker` after API compatibility validation);
- a bounded Gitea project-repository form under the approved owner, with the
  matching Artifact Keeper repository recorded as catalog metadata;
- a `Publish artifact` action that starts a Tekton PipelineRun and shows its
  status and checksum in Backstage.

The browser submits metadata only. It must not proxy large model files. The
Tekton Task reads from a controlled staging PV/object store or an approved
uploader source, performs resumable chunked upload to Artifact Keeper, verifies
SHA256 and reports the result. For the current Qwen files on `a3-server-00`,
the source must first be made reachable to the Task; Backstage cannot mount or
arbitrarily SSH into that host.

Token automation is a later phase, not part of the first write path. The MVP
uses separate out-of-band Kubernetes Secrets for an Artifact Keeper
read/provision credential, an Artifact Keeper CI publisher credential and a
Gitea project-provisioner credential. They are never returned by a browser,
written to Gitea or logged. Repository deletion, arbitrary permission changes
and unrestricted administrator-token creation remain disabled. The deployed
Artifact Keeper is version 1.6.0, so the repository and token API request
shapes must be probed against that instance before any production write.

Because the current Backstage MVP has `permission.enabled: false`, every new
write action must enforce the exact Backstage identity and allow-lists in the
backend itself. Do not expose repository or token administration to all
logged-in users merely by adding a frontend button.

## Two supported delivery paths

### `ora-space/desktop`

The desktop repository is primarily an application build, not a Kubernetes
service. Its useful first delivery path is:

```text
GitHub PR
  -> GitHub webhook
  -> Tekton clone/install/test
  -> GitHub Check Run: "Tekton / ora-desktop"

main branch or release tag
  -> locked Tekton build
  -> checksums + installer/archive + SBOM
  -> Artifact Keeper generic repository
  -> release links shown in Backstage
```

Do not create a Kubernetes deployment merely to call this CD. If the project
later gains a real web or server component, that component may use the OCI
path described below.

### Model serving platform

```text
Model files
  -> modelctl/chunked upload
  -> Artifact Keeper model repository

Backstage deployment request
  -> Gitea pull request
  -> Tekton schema/digest/reference validation
  -> review and merge
  -> Argo CD OutOfSync
  -> administrator manual Sync
  -> Crossplane ModelDeployment Composition
  -> cache-only validation
  -> NPU runtime only during an approved capacity window
```

The browser never proxies large model files. Backstage returns a versioned
`modelctl publish` command and later shows the resulting catalog status.

## Minimum Backstage application

The repository-owned image includes only:

- App and backend;
- Software Catalog and Catalog Graph;
- Software Templates / Scaffolder;
- Gitea OIDC authentication provider and static links to the existing Gitea
  repository;
- Kubernetes frontend and backend plugins;
- PostgreSQL-backed catalog, search and user settings.

The repository includes one custom Gitea deployment-request action. It is not
a general SCM action: repository, owner, branch, path, model version, runtime
profile, desired state, placement and allowed initiator are fixed or
allow-listed. It can create a branch, one YAML file, a PR and pending commit
status; it cannot merge or write Kubernetes. The form accepts bounded
TP/PP/replica/priority intent and the action always writes a stopped
ModelDeployment with the selected catalog references. The generic GitHub
publisher module is deliberately not loaded.

Initially omit TechDocs, Elasticsearch/OpenSearch, notifications, cost
insights and a complex permission policy. Link to the existing native UIs when
that is enough. This keeps the first image and operational surface small.

The current MVP sets `permission.enabled: false` so the Scaffolder template
chooser does not hide its **Choose** action when a browser session cannot send
credentials to `/api/permission/authorize`. This is a UI-availability choice,
not a Kubernetes write grant: the model request action still allow-lists the
Backstage initiator, model and runtime profile, while namespace-scoped
Kubernetes RBAC remains the authoritative boundary. Re-enable the permission
backend after the portal has a stable HTTPS identity/session path and verify
the authorization endpoint before tightening the UI policy.

### Catalog entities

Keep the catalog YAML in Git and seed at least:

| Kind | Entity | Purpose |
|---|---|---|
| System | `model-platform` | Parent platform |
| Component | `ora-desktop` | GitHub source, PR CI and release links |
| Component | `artifact-keeper` | Artifact/model/OCI registry entry |
| Component | `gitea` | Deployment-intent Git source |
| Component | `tekton` | CI execution service |
| Component | `argocd` | GitOps release controller |
| Component | `crossplane` | ModelDeployment control plane |
| Resource | `production-k3s` | Production cluster, without credentials |
| Resource | `qwen3-6-27b-w8a8` | Verified model version metadata |
| API | `model-deployment` | ModelDeployment contract; hidden until Offered |

Use `backstage.io/kubernetes-id`, namespace and cluster annotations to match
catalog entities to selected workloads. Dynamic state remains in GitHub,
Gitea, Artifact Keeper and Kubernetes; catalog YAML is descriptive metadata,
not a replacement database.

## Runtime layout and resource budget

The first release is a separate manifest set and namespace:

| Workload | Replicas | CPU request / limit | Memory request / limit | Persistence |
|---|---:|---:|---:|---|
| Backstage | 1 | 500m / 2 | 1Gi / 2Gi | None |
| PostgreSQL | 1 | 250m / 1 | 512Mi / 1Gi | 20Gi local Retain PV |

This adds about **750m CPU and 1.5Gi memory requests**. These are planning
values, not measured production usage. Re-check node requests, free disk and
events immediately before release. Backstage is stateless and can later be
scaled horizontally after PostgreSQL and session/auth behavior are verified.
The initial local PostgreSQL remains a single-node availability risk; the
Retain PV protects data from Helm uninstall but is not a backup.

Prepared Kubernetes objects:

- namespace `backstage`;
- Backstage Deployment, temporary internal NodePort Service and ServiceAccount;
- PostgreSQL StatefulSet, headless/ClusterIP Service and static local PV/PVC;
- readiness/liveness probes and optional ServiceMonitor;
- read-only RoleBindings in explicitly approved namespaces only.

The initial `http://110.120.0.3:30070` NodePort is a transition endpoint for
health, catalog and Kubernetes integration checks on the trusted internal
network. Move the same Deployment behind stable HTTPS before exposing it more
broadly or enabling any write action. The base URL is supplied at runtime, so
that migration does not require rebuilding the image.

Do not mount the Artifact Keeper, Gitea or other components' PVs into
Backstage.

## Authentication, integrations and secret separation

Use the internal Gitea OIDC provider for interactive login and do not enable
guest login. For the temporary internal validation endpoint the callback is
`http://110.120.0.3:30070/api/auth/oidc/handler/frame`; replace it and the base
URL with stable HTTPS before broader use. The production `gitadmin` account is
mapped to `User:default/gitadmin` by its exact OIDC email.

Use separate credentials with separate duties:

| Secret purpose | Minimum permission |
|---|---|
| Gitea OIDC | login callback only |
| Backstage PostgreSQL | Backstage database only |
| Gitea request token | write a branch/file, create PR and commit status in only `gitadmin/model-platform-config`; no admin or merge permission |
| Gitea CI status token | write commit status in the same repository; no admin or merge permission |

A GitHub catalog/check reader and Artifact Keeper metadata reader remain
deferred. The verified Qwen entity and constrained request template are bundled
in the first immutable image; Gitea remains the desired-state source rather
than the Backstage catalog database.

All are provisioned out of band as Kubernetes Secrets and referenced from
values. No Secret value, private key, token, rendered Secret or kubeconfig may
enter this repository or the browser bundle.

The in-cluster Kubernetes ServiceAccount is read-only and namespace-scoped.
It may list/get/watch only the resource types used on entity pages, initially
in `backstage`, `crossplane-system` and `model-serving`. It must not read Secrets or write
any resource. Because server-side Kubernetes credentials provide the same
cluster view to every Backstage user, the RBAC boundary is the security
boundary; Backstage UI permissions alone are insufficient.

## Stable endpoints and TLS prerequisite

Normal use needs stable names rather than raw NodePorts:

| Endpoint | First stable purpose |
|---|---|
| `backstage.<internal-domain>` | portal and Gitea OIDC callback |
| `artifacts.<internal-domain>` | Artifact Keeper UI/API |
| `registry.<internal-domain>` | Artifact Keeper OCI v2 endpoint for Docker/K3s |
| `git.<internal-domain>` | Gitea web and Git HTTP |
| `argocd.<internal-domain>` | administrator UI |

Use the existing Traefik/Ingress path and an internal CA or trusted certificate
chain. A named Cloudflare Tunnel may expose only the GitHub webhook endpoint;
it is not the cluster's internal service mesh. The current Quick Tunnel is a
temporary CI experiment and must not become a production OAuth or registry
URL.

Artifact Keeper is now the required destination for new integrated-platform
images at `110.120.0.3:30670/container-images`. `server-00` K3s currently reaches
that Registry v2 endpoint through node-local internal-HTTP configuration. Create
a repository-scoped read-only `imagePullSecret` only in consuming namespaces,
and pin images by digest. An authenticated disposable pull passed on
`server-00` on 2026-08-14; other workers remain unvalidated. Existing 8889
references remain unchanged until migrated one consumer at a time.

The hardened target remains `https://registry.<internal-domain>`. Install the
issuing CA on every K3s node if it is private, then remove the HTTP exception
only after HTTPS push/pull and rollback tests pass.

## Backstage model-platform backend contract

The small backend module provides the following read-only aggregate API for the
recipe page (all data is filtered to the fixed platform contract):

- `GET /api/model-platform/catalog` — allow-listed Gitea `ModelVersion` and
  `ModelRuntimeProfile` documents, reduced to the recipe fields; no model bytes
  or credentials;
- `GET /api/model-platform/deployments` — selected ModelDeployment and
  model-platform workload conditions from Kubernetes, including RayService,
  cache Job/PVC and Service summaries;
- the authenticated Scaffolder action
  `model-platform:gitea-create-deployment-pr` — validates an allow-listed
  request and creates exactly one stopped Gitea branch and PR. There is no
  direct Kubernetes write route.

Artifact repository provisioning, project creation, artifact publishing and
CI status aggregation remain planned follow-up capabilities. They are not
implicitly enabled by the recipe integration.

The write action accepts model version, certified runtime profile and bounded
TP/PP/replica/priority intent. It must reject arbitrary images, node
names, host paths, NPU card identifiers, namespaces and free-form Kubernetes
YAML. It records requested and effective values separately, never merges the
PR and never calls Kubernetes.

The first Software Templates are:

1. register an existing component/repository;
2. register a model version and return the `modelctl publish` command;
3. request/update/stop a model deployment by creating a Gitea PR.

The source-level Recipe connection and its no-NPU validation are recorded in
`model-deployment-recipe-integration-20260819.md`. The deployed Pod remains on
the previously released image until a separate Backstage-only rollout is
approved.

Template 3 stays hidden or disabled until the ModelDeployment XRD is Offered,
the Composition renders successfully with no real XR, and the target Gitea
path is watched by the reviewed Argo CD Application.

The repository/project and publish actions are a separate follow-up to the
already-deployed ModelDeployment template. They must first pass a read-only
API compatibility check and a dry-run/negative-input test using a disposable
repository. They do not call Kubernetes and do not change Argo, Crossplane,
existing model workloads or NPU allocation.

## CI/CD integration details

### PR feedback

The GitHub path is independent of Backstage:

1. GitHub sends signed PR events to the dedicated EventListener.
2. Tekton creates one PipelineRun with PR/revision labels.
3. A start reporter creates a GitHub Check Run.
4. clone/install/test execute in one Pipeline Pod, using the bounded 100Gi
   cache PVC for Git objects and dependency caches.
5. A finally reporter updates the Check Run with success/failure, a concise
   summary and a log link.

Backstage displays or links to the same Check; it does not duplicate the CI
engine. Preserve clean source workspaces between revisions and cache only Git
objects/package stores/build caches, never untrusted installed output as an
authoritative result.

### Release publishing

For `ora-space/desktop`, a main/tag Pipeline packages installers or archives,
creates SHA256 and SBOM files, and uploads them to an Artifact Keeper **generic
release repository** using a release-only writer token. Artifact immutability
and versioned paths make retries safe. Backstage shows the release metadata
and download link.

For a real OCI service, use a rootless builder, push to the Artifact Keeper
HTTPS Docker repository, resolve the immutable digest, and create a Gitea
GitOps PR changing that digest. Tekton must not run `kubectl apply`; Argo CD
remains the release boundary.

## Implementation gates

### Gate 0 — preserve and measure

- collect current Pods, requests, disk, PV and events;
- keep existing workloads unchanged;
- confirm internal DNS names, certificate issuer and rollback path.

### Gate 1 — model API without runtime impact

- mirror and pin the Crossplane Composition Function;
- install the ConfigMap-only Pipeline-mode Composition and update the XRD;
- verify Function Healthy, XRD Offered and zero real XR instances;
- keep NPU, Ray/KubeRay, cache, PVC and workload usage at zero.

### Gate 2 — Backstage portal and constrained PR request

- build and mirror the Backstage image by immutable digest;
- deploy Backstage and its PostgreSQL without touching existing PVs;
- verify login, catalog, Kubernetes read-only pages and links;
- confirm its ServiceAccount cannot read Secrets or write resources;
- create only an allow-listed, stopped request branch/PR in Gitea and verify
  that no Kubernetes resource changes before merge/manual Sync.

### Gate 2a — unified repository and publish MVP (planned)

- add the read-only Artifact Keeper repository status API first;
- validate the installed Artifact Keeper 1.6.0 repository/token API against a
  disposable repository before adding any write action;
- add bounded Backstage actions for Artifact Keeper repository creation and
  Gitea project creation, with separate provisioner credentials;
- trigger a Tekton chunked-upload PipelineRun instead of uploading large files
  through the browser or Backstage;
- verify checksum, retry/idempotency and no Kubernetes/NPU side effects;
- keep delete, arbitrary permission changes and administrator-token issuance
  disabled until a separate security review.

### Gate 3 — stable HTTPS and GitOps ownership

- add stable TLS endpoints for Artifact Keeper, Gitea and Backstage;
- verify Artifact Keeper OCI push/pull by digest from a test namespace;
- keep old endpoints during the migration window;
- add reviewed XRD/Composition/catalog/request paths to Gitea and a manual Argo
  CD Application with prune and self-heal disabled.

### Gate 4 — request-by-PR safe control-plane proof

- prove invalid image/namespace/node/NPU fields cannot be submitted and are
  rejected again by Tekton schema policy;
- require successful `tekton/model-platform-policy` PR status and human review;
- merge one harmless control-plane request and observe Argo OutOfSync before
  manual Sync;
- after manual Sync, verify exactly one ModelDeployment and one composed status
  ConfigMap, with no Deployment, Service, Job, PVC, Ray or NPU object.

### Gate 5 — deferred CI, cache and runtime

- resume `ora-space/desktop` CI only after the user explicitly reactivates it;
- run the cache-only test after explicit disk/network approval;
- run the Qwen NPU end-to-end test only in an approved idle window;
- verify health, inference, stop/start, rollback and cache reuse.

## Minimum acceptance checklist

- Gitea OIDC login works and guest login is disabled; HTTPS is required before
  broader exposure.
- Catalog shows the platform components and verified Qwen model.
- Backstage shows only approved Kubernetes namespaces/resources and no Secret.
- The Crossplane API is Offered before request templates are enabled.
- Before the Gate 4 manual Sync there are zero ModelDeployment instances;
  afterwards there is exactly one stopped request plus its status ConfigMap,
  with zero cache Jobs and NPU resources.
- Existing workloads remain Ready and their PV/PVC bindings are unchanged.

## Failure-domain guide

| Symptom | First component to inspect |
|---|---|
| GitHub PR has no Check | GitHub webhook delivery, tunnel, EventListener/Trigger |
| Check starts but clone/install/test fails | Tekton PipelineRun/Task Pod, cache permissions, scoped proxy |
| Build passes but release is absent | release Pipeline, Artifact Keeper writer permission/quota/TLS |
| Backstage login loops | stable base URL, Gitea OIDC callback, cookie/session config |
| Catalog entity is missing | catalog location, GitHub/Gitea reader token, entity YAML |
| Entity exists but no workload appears | Kubernetes annotations, namespace/cluster mapping, read RBAC |
| Request form succeeds but no PR | Backstage Gitea writer/action and repository branch policy |
| PR validates but cluster does not change | expected until merge and manual Argo Sync |
| Argo Sync succeeds but no composed resource | XRD Offered state, Composition/function pipeline, Crossplane events |
| Runtime is Pending | cache readiness, node selector/resources, approved NPU capacity |

This sequence evolves the existing releases in place. It does not require a
cluster rebuild. Database/PV migration, automatic Argo sync, prune, HA and
multi-node scheduling remain separate later changes.

## Design references

- [Backstage production deployment](https://backstage.io/docs/golden-path/deployment/)
- [Backstage on Kubernetes](https://backstage.io/docs/next/deployment/k8s/)
- [GitHub authentication provider](https://backstage.io/docs/auth/github/provider/)
- [Gitea catalog integration](https://backstage.io/docs/integrations/gitea/locations/)
- [Backstage Kubernetes configuration](https://backstage.io/docs/features/kubernetes/configuration/)
- [Backstage Kubernetes authentication](https://backstage.io/docs/features/kubernetes/authentication/)
- [Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [Software Templates](https://backstage.io/docs/features/software-templates/)
