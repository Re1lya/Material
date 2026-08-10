# Production minimal GitOps loop acceptance record

> Acceptance date: 2026-08-10
>
> Scope: one private Gitea repository, one read-only robot, one Argo CD
> AppProject, one manually synchronized Application and one ConfigMap.

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

The accepted Gitea and Argo CD revision is:

```text
233601ac8a4f5f0bdf6f38cf1b167c314d936283
```

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

Two files were added under the isolated source path:

```text
environments/production/bootstrap/kustomization.yaml
environments/production/bootstrap/status-configmap.yaml
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

Its `generation` is `1`, and its repository and source path data match the
reviewed Git manifest.

## 6. Isolation and regression checks

- `model-platform-system` contains no Pod, Deployment, StatefulSet, DaemonSet,
  Job, CronJob, Service, PVC or application Secret.
- The only non-system application object in that namespace is
  `gitops-bootstrap-status`.
- Argo CD Repo Server and Application Controller logs contained no error,
  fatal or panic lines for the acceptance window.
- Gitea and PostgreSQL remained Ready with zero restarts.
- Artifact Keeper Backend, Web and PostgreSQL remained Ready with zero
  restarts.
- Node requests remained approximately 48.5 CPU (75%) and 128396Mi memory
  (16%); the loop created no Pod and added no workload resource request.

## 7. Operational checks

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

## 8. Next gate

Do not expand this Application directly into a general cluster administrator.
The next reviewed increment should add schema and repository CI, then introduce
another narrowly scoped path or project. Workloads, Secrets, node writes,
prune, self-heal and NPU requests remain separate approval gates.
