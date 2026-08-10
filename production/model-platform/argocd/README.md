# Argo CD production bootstrap

This directory records the initial Argo CD deployment for the production K3s
cluster on `server-00`.

## Scope

- Helm chart: `argo-cd` 10.1.4
- Argo CD: 3.4.5
- Runtime Pods: application controller, API/UI server, repository server, and
  one Redis cache
- Scheduling: Linux AMD64 `server-00` only
- Exposure: ClusterIP only; use a local port-forward for the first validation
- Persistent volumes: none; desired state remains in Kubernetes CRDs and Redis
  is only a disposable cache
- Disabled: Dex, notifications, commit server, Redis HA, Redis exporter
- ApplicationSet Deployment: rendered by the chart but held at zero replicas
- Git repositories and Git credentials: not configured by this Helm release
- Applications and projects: not created by this Helm release

The subsequent minimal production connection is declared in `../gitops/`.
It adds one project-scoped read-only Gitea credential, one least-privilege
AppProject and one manually synchronized ConfigMap Application. It does not
change this Helm release or broaden the locked `default` project.

Argo CD creates a permissive `default` AppProject automatically on first
startup. Apply `default-project-lockdown.yaml` immediately after the Helm
install. It leaves that required project present but removes every repository,
destination, and resource permission. Real platform projects must be declared
separately and reviewed before use.

The steady-state resource requests are 600m CPU and 1 GiB memory. The limits
are 3 CPU and 3 GiB memory. The Redis secret initialization Job and repo-server
copy utility init container have additional temporary limits recorded in the
values file.

## Artifact source

Download the chart from the official Argo Helm release and verify it before
use:

```bash
curl -fL \
  -o argo-cd-10.1.4.tgz \
  https://github.com/argoproj/argo-helm/releases/download/argo-cd-10.1.4/argo-cd-10.1.4.tgz
echo '142d2eaaa2adf9051c109c396c5fe3af742674011a5837df262bd6f8f2991d2c  argo-cd-10.1.4.tgz' \
  | sha256sum -c -
```

The deployment uses copies of the Argo CD and Redis images in the internal
registry at `110.120.0.3:8889`. Mirror and inspect those images before running
Helm; do not let production Pods pull unreviewed floating tags from the public
Internet.

The reviewed Linux AMD64 manifest digests are:

- `platform/argocd:v3.4.5`: `sha256:bd9ef458249f5d7778d906a4d77bcfa61b85d69a0efc8e802cd02f35eb63dede`
- `library/redis:8.2.3-alpine`: `sha256:e499175dfb27569cd40010c2eee346113db95fdd0efc88ab9fd70a9e807f4542`

The values file uses `tag@digest` references, so moving either tag cannot
silently change the workloads deployed by this release.

## Production commands

Always use the K3s kubeconfig explicitly. Plain `kubectl` on `server-00` points
at an unrelated Kind POC cluster.

```bash
sudo k3s kubectl config current-context
sudo k3s kubectl apply -f namespace.yaml
sudo helm upgrade --install argocd ./argo-cd-10.1.4.tgz \
  --kubeconfig /etc/rancher/k3s/k3s.yaml \
  --namespace argocd \
  --values values-production.yaml \
  --wait \
  --timeout 10m
sudo k3s kubectl apply -f default-project-lockdown.yaml
```

For initial UI access, keep the service private and forward its TLS port:

```bash
sudo k3s kubectl -n argocd port-forward service/argocd-server 8443:443
```

Then open `https://127.0.0.1:8443`. Retrieve the generated initial admin
password only at the moment it is needed, change it immediately, and do not
write it into this repository or shell history.
