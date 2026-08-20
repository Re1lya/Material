# Backstage Artifact Keeper and Tekton publish MVP — 2026-08-19

## Scope

This change adds a restricted Backstage surface for Artifact Keeper repository
metadata, repository-scoped token requests and Tekton artifact-publish status.
It is a repository-side implementation and renderable release design. It has
not been applied to the production K3s cluster and it does not change the
currently running Artifact Keeper, Gitea, Argo CD, Crossplane, Tekton or model
workloads.

The first write boundary is intentionally narrower than a general registry
administrator:

- only the allow-listed Backstage identity `user:default/gitadmin` may use the
  backend write routes;
- repository keys must use an allow-listed prefix (`platform-` or `model-`);
- formats are limited to `generic`, `huggingface` and `docker`;
- repository quota is capped at 500 GiB by the backend;
- tokens are repository-scoped and may be `read` or `read + write` only;
- delete, admin, wildcard and cross-repository tokens are not exposed;
- token plaintext is never logged or persisted by Backstage;
- one-time token reveal remains disabled until Backstage has stable HTTPS and a
  separately approved production policy enables it.

The existing fixed Gitea `model-platform-config` repository remains the GitOps
source of truth. This MVP does not create arbitrary Gitea repositories or
change Gitea permissions.

## Implemented source layout

| Area | Source | Responsibility |
|---|---|---|
| Backend | `app/packages/backend/src/modules/artifactManagementApi.ts` | authenticated, allow-listed Artifact Keeper requests; Tekton status read; internal EventListener submission |
| Backend config | `app/packages/backend/config.d.ts` | optional `modelPlatform.artifactManagement` schema |
| Frontend | `app/packages/app/src/modules/artifactManagement/` | repository form, guarded token form, publish metadata form and PipelineRun status |
| Example config | `app/app-config.artifact-management.example.yaml` | opt-in configuration template; no real secret |
| Tekton | `tekton/artifact-publish/` | namespace, policy, RBAC, Pipeline and internal EventListener |
| Backstage RBAC | `backstage/kubernetes/rbac.yaml` | read-only PipelineRun/TaskRun/Pod log access in `artifact-publish` |

The frontend submits metadata only. There is deliberately no browser file
input and no direct Kubernetes, Ray or NPU write path.

## Data path

```text
approved staging PVC
        |
        | source_ref=staging://...
        v
Backstage backend (auth + allow-list)
        |
        | internal EventListener request
        v
Tekton PipelineRun in artifact-publish
  validate-input -> upload chunks -> verify SHA256
        |
        v
Artifact Keeper repository
```

The upload Task uses the resumable Artifact Keeper API and keeps the source
file on the staging PVC. It does not copy a 30–40 GiB model through the browser
or into the Backstage Pod. The source is resolved below the mounted workspace,
the requested size and lowercase SHA256 are checked, and the final metadata is
read back before the Pipeline succeeds. The Pipeline is fixed to
`server-00`/`amd64` for the first release and contains no accelerator resource
request, NPU node label or NPU toleration.

## Production enablement gates

The current deployed Backstage config intentionally omits this optional
section, so the new page renders a disabled/read-only state and cannot call
Artifact Keeper write APIs. Enable it only after all of the following are
approved:

1. Put the Artifact Keeper provision credential in the Backstage runtime Secret
   through the existing secret-injection process. Do not put the value in Git.
2. Create a namespace-local `artifact-keeper-image-pull` Secret in
   `artifact-publish`; image pull Secrets do not cross namespaces.
3. Create the namespace-local `artifact-keeper-publisher` Secret containing a
   repository-scoped write token. It is read only by the upload/verify Tasks.
4. Provision and permission-review the `artifact-publish-staging` PVC. Its PV,
   capacity, source-ingestion process and ownership are intentionally not
   guessed by this MVP.
5. Apply `tekton/artifact-publish/namespace.yaml` and the rest of its
   kustomization using a server-side dry-run first. Apply the Backstage
   `artifact-publish` Role/RoleBinding only after that namespace exists.
6. Expose Backstage through stable HTTPS, then decide whether one-time token
   reveal is acceptable. Keep `allowOneTimeTokenReveal: false` by default.
7. Render and publish a new Backstage image, verify the image digest and perform
   a rollout only after the previous checks pass.
8. Start with a tiny non-sensitive artifact and verify PipelineRun, TaskRuns,
   pod logs, Artifact Keeper metadata and checksum. Do not use a model file for
   the first test.

The example configuration is intentionally not included by
`app-config.yaml`; merging it before the Secret and HTTPS gates would either
fail startup or create an unsafe token-reveal expectation.

## Observability and rollback

Backstage reads only the dedicated `artifact-publish` namespace. Its
ServiceAccount has `get/list/watch` for PipelineRuns and TaskRuns and
`get/list/watch` plus `pods/log` read access; it cannot create, patch or delete
Tekton/Kubernetes objects. The EventListener ServiceAccount is the only path
that creates a PipelineRun, and its TriggerTemplate references only the fixed
`publish-artifact` Pipeline.

If the rollout fails, remove/disable the optional Backstage config and stop
using the new page; no model runtime or existing CI Pipeline is affected. Do
not delete the Artifact Keeper repository or PVC as a rollback step. A failed
upload session can expire naturally; cleanup of an individual test session is
separate from deleting platform storage.

## Validation performed locally

- TypeScript full check: passed.
- Backend lint: passed.
- Frontend lint: passed after removing a pre-existing nested-ternary lint error
  in the model recipe status card.
- Backend package build: passed.
- Frontend package build: passed.
- `ArtifactManagementPage` disabled-mode test: passed.
- PyYAML parse and static policy checks for all 15 artifact-publish manifests:
  passed; all images are digest-pinned and no accelerator marker is present.

These are local source/render checks. They are not a production rollout or a
claim that the EventListener, staging PVC or Artifact Keeper write credential
has been validated in K3s.
