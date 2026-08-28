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
