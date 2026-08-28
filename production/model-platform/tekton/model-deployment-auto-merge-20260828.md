# Stopped ModelDeployment auto-merge design — 2026-08-28

## Scope

This release adds a constrained Tekton task that replaces the manual Gitea
merge click for Backstage-generated **Stopped** ModelDeployment requests. It is
not a general pull-request merge bot and it cannot access Kubernetes or Argo
CD APIs.

```text
Backstage PR
  -> validate exact PR head
  -> validate catalog and ModelDeployment policy
  -> verify auto-merge hard gates
  -> merge exact head with Gitea API
  -> main push starts the ordinary validation Pipeline again
```

## Hard gates

The merge task runs only when all of the following are true:

- source provider is production Gitea;
- event kind is `pull-request`;
- the ordinary `clone-and-validate` task succeeded;
- PR base is `main` and head repository is
  `gitadmin/model-platform-config`;
- PR head SHA equals the exact 40-character commit validated by Tekton;
- branch starts with `backstage/modeldeployment-`;
- the PR adds exactly one file;
- the file is under `environments/production/modeldeployments/`;
- `desiredState=Stopped` and `workerReplicas=0`;
- request mode is `declarative-stopped`;
- effective TP, replicas and NPU annotations are all zero;
- the request does not carry `crossplane.io/paused`.

The merge uses `head_commit_id`, does not force merge, and deletes the generated
branch after success.

## Identity

The Task references namespace Secret
`model-platform-ci/gitea-model-deployment-merger`. The Secret must contain a
dedicated token issued to the existing non-global-admin `release-bot`, with
`write:repository` scope. It is separate from the clone reader and commit-status
writer tokens and can be revoked without affecting them.

The token is mounted only into the merge step. The runner ServiceAccount still
has `automountServiceAccountToken: false`, so the Task cannot write Kubernetes
objects.

## Non-goals

- Running requests are never auto-merged by this first release.
- Schema, RuntimeProfile, AppProject, Application and other platform changes
  are never auto-merged.
- The Task does not call Argo CD.
- This release does not enable Argo automated sync, prune or self-heal.

## Validation before production

- Pipeline and Trigger YAML parsed successfully.
- The embedded Python merge policy compiled successfully.
- Production K3s API server dry-run accepted the Pipeline, four bindings,
  TriggerTemplate and both EventListeners.

Production acceptance requires a newly generated disposable Stopped request:
the PR must validate, merge automatically, trigger a successful main
PipelineRun, and leave Argo OutOfSync while automated sync is still disabled.

## Production release and acceptance — 2026-08-28

### First production attempt failed

- Pipeline `model-platform-ci/validate-model-platform-config` generation 10
  contained the original auto-merge task, which read the generated request
  file from the shared Pipeline workspace.
- Smoke PR #11
  (`backstage/modeldeployment-qwen38-stopped-auto-smoke-acceptance`, head
  `971461a3594849ec0cfdd0825fa499f70b9de8b8`, new file
  `environments/production/modeldeployments/qwen38-stopped-auto-smoke.yaml`)
  triggered PipelineRun `model-platform-config-validation-b6pg4`.
- `clone-and-validate` Succeeded; `auto-merge-stopped-request` Failed with
  `FileNotFoundError`: PipelineRun workspaces are per-Task-Pod `emptyDir`, so
  the clone directory from the first Task Pod does not exist in the merge Task
  Pod.
- No merge, no Gitea main change, no Argo sync, no new XR and no NPU Pod
  occurred as a result of that failure.

### Fix (Material `8a3e612`)

The merge task no longer reads the previous Task's workspace. It fetches the
exact changed file from the Gitea Contents API at the already-validated
40-character head revision and re-checks the policy before merging.

### Controlled release

- Local checksum
  `sha256 2c0f32ef9c827eadb4565215a7b0f298a59a0eaf68c45b42011c157e5b2950d7`
  verified on `server-00` before release
  (`/tmp/model-platform-release-20260828-automerge/pipeline.yaml`).
- `sudo k3s kubectl apply --dry-run=server -f pipeline.yaml` returned
  `configured (server dry run)` for the Pipeline only.
- Scoped apply updated only Pipeline
  `model-platform-ci/validate-model-platform-config` (generation 10 -> 11);
  RBAC, NetworkPolicy, Triggers and all other Pipelines were untouched.
- Live object verified to contain the Contents-API read and no
  workspace-read in the merge task.

### Re-trigger and automatic merge evidence

- PR #11 was closed and reopened (HTTP 201/201), which re-delivered the Gitea
  `pull_request` webhook with action `reopened`.
- PipelineRun `model-platform-config-validation-2zqdm` at head
  `971461a3594849ec0cfdd0825fa499f70b9de8b8`: Succeeded.
  - `clone-and-validate` Succeeded
  - `auto-merge-stopped-request` Succeeded
  - `finally/report-gitea-commit-status` Succeeded
- PR #11 became `state=closed, merged=true`; merge commit
  `0021e86439d43ef93b0f79587dfaeb8b57b51a44`; the generated branch was deleted
  automatically (branch API now 404).
- The merge push started main-push PipelineRun
  `model-platform-config-validation-67k8q` at `0021e864…`:
  `clone-and-validate` Succeeded, `report-gitea-commit-status` Succeeded
  (auto-merge correctly skipped for `event-kind=push`).

### Downstream state kept inert

- Argo CD `model-platform-deployment-requests` observed OutOfSync/Healthy with
  automated sync still absent (`spec.syncPolicy.automated` unset); the
  OutOfSync diff is exactly the added `qwen38-stopped-auto-smoke`
  ModelDeployment.
- `model-serving` still contains only the pre-existing stopped-state CPU head
  and the two completed cache Jobs; cluster-wide NPU requests remain zero and
  no new XR was created.
- `k12-data-pipeline`, `model-platform-bootstrap`,
  `model-platform-training-system` and their workloads were not modified.
