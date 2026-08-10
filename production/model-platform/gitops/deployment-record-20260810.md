# Production minimal GitOps loop acceptance record

> Acceptance date: 2026-08-10
>
> Scope: one private Gitea repository, one read-only robot, one Argo CD
> AppProject, one manually synchronized Application, one ConfigMap, and a
> controlled update/rollback/forward-recovery exercise.

## 1. Result

The first production GitOps loop is complete:

```text
Gitea main commit
  -> Argo CD repo-server authenticated clone and Kustomize render
  -> application-controller detected OutOfSync/Missing
  -> administrator initiated a commit-pinned manual sync
  -> model-platform-system/gitops-bootstrap-status
  -> Application Synced/Healthy
```

The current accepted Gitea and Argo CD revision is:

```text
58abbd4bc926ffd3d186f75c924d99dafec4df73
```

The initial accepted revision was
`233601ac8a4f5f0bdf6f38cf1b167c314d936283`. Both revisions were retained and
used in the rollback exercise; no history rewrite was performed.

No model file, cache Job, workload, persistent volume or NPU resource was
created.

## 2. Gitea identity and repository boundary

| Item | Accepted value |
|---|---|
| Repository | private `gitadmin/model-platform-config` |
| Branch | `main` |
| Robot | `argocd-reader` |
| User type | restricted, private, active, non-admin |
| Repository permission | `pull=true`, `push=false`, `admin=false` |
| Token scope | `read:repository` |

The personal token scope applies only to repositories visible to the robot.
The robot was added as a read-only collaborator to this one private repository
and was not granted membership in other repositories or organizations.

The token is stored only in the Kubernetes Secret
`argocd/model-platform-config-repository`. The temporary token response file
was removed after Secret creation, and credential shell variables were unset.
No credential value is present in Git.

The isolated source path and its repository validator contain:

```text
environments/production/bootstrap/kustomization.yaml
environments/production/bootstrap/status-configmap.yaml
ci/validate-bootstrap.sh
```

Their contents were fetched using the read-only token and matched the reviewed
staging files by SHA256 before Argo CD was connected.

## 3. Argo CD policy boundary

| Object | Boundary |
|---|---|
| AppProject | `argocd/model-platform` |
| Source repository | exact internal Gitea URL only |
| Destination | local cluster, `model-platform-system` only |
| Cluster-scoped kinds | none |
| Namespace-scoped kinds | core `ConfigMap` only |
| Application | `argocd/model-platform-bootstrap` |
| Source path | `environments/production/bootstrap` |
| Target revision | `main` |
| Automated sync | disabled |
| Prune | disabled |
| Self-heal | disabled |
| CreateNamespace | disabled |

The namespace is an administrator-owned bootstrap object. The Application has
no resource finalizer, so deleting the Application does not implicitly delete
the accepted ConfigMap.

## 4. Dry-run and rendering evidence

K3s Kustomize rendered exactly one object:

```text
kind: ConfigMap
name: gitops-bootstrap-status
namespace: model-platform-system
```

The namespace, AppProject, Application and rendered ConfigMap passed the
applicable client or API server dry-runs. The deprecated Kustomize
`commonLabels` syntax was replaced with the current `labels` syntax before the
repository commit.

## 5. Manual synchronization evidence

Before synchronization:

```text
sync:       OutOfSync
health:     Missing
automated:  null
ConfigMap:  absent
```

This proved that repository polling worked and that no accidental automatic
sync was enabled.

The administrator then initiated one sync pinned to commit
`233601ac8a4f5f0bdf6f38cf1b167c314d936283`, explicitly with `prune=false`.

After synchronization:

```text
sync:               Synced
health:             Healthy
operation phase:    Succeeded
sync revision:      233601ac8a4f5f0bdf6f38cf1b167c314d936283
operation revision: 233601ac8a4f5f0bdf6f38cf1b167c314d936283
managed resources:  1 ConfigMap
```

The live ConfigMap has Argo CD tracking annotation:

```text
model-platform-bootstrap:/ConfigMap:model-platform-system/gitops-bootstrap-status
```

At initial acceptance its `generation` was `1`, and its repository and source
path data matched the reviewed Git manifest.

## 6. Controlled update, rollback and recovery

A repository-local validator was added in Gitea commit:

```text
86bec3e3df031b34d3b9439ddac0966b9e5ee9c3
```

It requires the bootstrap render to contain exactly one
`model-platform-system/gitops-bootstrap-status` ConfigMap and performs a
client-side Kubernetes dry-run. The script passed against the production K3s
client:

```text
bootstrap_validation=PASS
rendered SHA256: b101f72efbca751789485b44f6d68b67b80e81eb562d8598a17d2026127054ba
```

The ConfigMap was then changed to `generation=2` and given
`validationPolicy=manual-sync-no-prune` in commit:

```text
58abbd4bc926ffd3d186f75c924d99dafec4df73
```

The read-only robot downloaded both changed files and their SHA256 values
matched the reviewed copies before synchronization. The hard refresh detected
the new revision as `OutOfSync/Healthy`, while the live ConfigMap remained at
generation 1. This again proved that automatic synchronization was disabled.

The following three commit-pinned operations were executed with
`prune=false`:

| Operation | Pinned revision | Live generation | Result |
|---|---|---:|---|
| Update | `58abbd4bc926ffd3d186f75c924d99dafec4df73` | 2 | `Synced/Healthy` |
| Rollback | `233601ac8a4f5f0bdf6f38cf1b167c314d936283` | 1 | succeeded; latest `main` became `OutOfSync` |
| Forward recovery | `58abbd4bc926ffd3d186f75c924d99dafec4df73` | 2 | `Synced/Healthy` |

The final Application revision is `58abbd4bc926ffd3d186f75c924d99dafec4df73`,
the live ConfigMap is generation 2, and `spec.syncPolicy.automated` remains
absent. No resource was pruned during any operation.

## 7. Branch protection

The Gitea `main` branch now has a branch-protection rule. It allows normal
pushes but disables force push. Required approvals, status checks and signed
commits remain disabled because there is not yet an independent reviewer or
automated CI identity. Enabling those gates now would risk locking out the
only controlled writer without providing real review evidence.

The protection is therefore an initial history-safety control, not a claim of
full pull-request enforcement. No destructive force-push test was performed;
the protection was verified by reading the stored Gitea API configuration.

## 8. Isolation and regression checks

- `model-platform-system` contains no Pod, Deployment, StatefulSet, DaemonSet,
  Job, CronJob, Service, PVC or application Secret.
- The only non-system application object in that namespace is
  `gitops-bootstrap-status`.
- Argo CD Repo Server and Application Controller logs contained no error,
  fatal or panic lines for the final regression window.
- Gitea and PostgreSQL remained Ready with zero restarts.
- Artifact Keeper Backend, Web and PostgreSQL remained Ready with zero
  restarts.
- Node requests remained approximately 48.5 CPU (75%) and 128396Mi memory
  (16%); the loop created no Pod and added no workload resource request.

## 9. Operational checks

Inspect the loop with the production K3s client:

```bash
sudo k3s kubectl -n argocd get application model-platform-bootstrap
sudo k3s kubectl -n argocd describe application model-platform-bootstrap
sudo k3s kubectl -n argocd get appproject model-platform -o yaml
sudo k3s kubectl -n model-platform-system get configmap \
  gitops-bootstrap-status -o yaml
```

If the Application reports a repository or manifest generation error, inspect
Repo Server first. If repository comparison succeeds but synchronization is
forbidden or fails, inspect AppProject and Application Controller.

```bash
sudo k3s kubectl -n argocd logs deployment/argocd-repo-server --since=10m
sudo k3s kubectl -n argocd logs \
  statefulset/argocd-application-controller --since=10m
```

Run the local repository guard before proposing another bootstrap change:

```bash
KUBECTL_CMD='sudo k3s kubectl' \
  bash repository/ci/validate-bootstrap.sh
```

## 10. Next gate

Do not expand this Application directly into a general cluster administrator.
The next reviewed increment should add schema checks and an actual CI execution
identity, then introduce another narrowly scoped path or project. The validator
exists but is not automatically enforced because Gitea Actions remains
disabled. Workloads, Secrets, node writes, prune, self-heal and NPU requests
remain separate approval gates.
