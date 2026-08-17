# Minimal production GitOps loop

This directory defines the first deliberately constrained connection between
the production Gitea and Argo CD installations.

## Safety boundary

- Gitea repository: `gitadmin/model-platform-config`
- Repository credential: dedicated `argocd-reader` user with read-only access
- Argo CD project: `model-platform`
- Destination namespace: `model-platform-system`
- Allowed managed kind: core `ConfigMap` only
- Automatic sync: disabled
- Prune: disabled
- Self-heal: disabled
- NPU, model cache, inference and persistent storage: not used

The namespace, AppProject and Application are bootstrap objects applied by an
administrator. The repository Secret is created directly in the cluster and
is never committed. Argo CD manages only the contents under
`repository/environments/production/bootstrap/`.

The first acceptance object is
`model-platform-system/gitops-bootstrap-status`. Its only purpose is to prove
that a reviewed Gitea commit can be detected and manually synchronized by Argo
CD without granting broader permissions.

## Apply order

Always use the production K3s client explicitly on `server-00`:

```bash
sudo k3s kubectl apply -f namespace.yaml
sudo k3s kubectl apply -f appproject.yaml
sudo k3s kubectl apply -f application.yaml
```

Create `argocd/model-platform-config-repository` separately with the standard
Argo CD repository Secret label and the internal repository URL. Do not put the
password or token in Git.

The first synchronization must be initiated manually after inspecting the
Application diff. Do not add `spec.syncPolicy.automated` until a later review.

Before committing a change to the bootstrap path, run the repository validator:

```bash
KUBECTL_CMD='sudo k3s kubectl' \
  bash repository/ci/validate-bootstrap.sh
```

It requires the render to contain exactly one ConfigMap with the accepted name
and namespace, then validates the model catalog and all files in
`environments/production/modeldeployments/`.

## Control-plane request application

`model-platform-control-plane` and `model-platform-deployment-requests` form a
second, independently scoped AppProject/Application pair. They are prepared,
not production evidence. Their only allowed destination object is the
namespaced `platform.example.com/ModelDeployment` kind in `model-serving`.
The source uses Argo CD directory mode with `include: '*.yaml'`; README and
other files are ignored. Automatic sync, prune and self-heal are absent.

The schema and validator force current requests to use the verified Qwen
references with `desiredState: Stopped` and `acceleratorPool:
control-plane-only`. Backstage creates a PR, Tekton validates its exact head
SHA and writes the `tekton/model-platform-policy` commit status, a human merges,
and an administrator later inspects and manually synchronizes the Argo diff.
The enforced Crossplane Composition may then create only a status ConfigMap.
