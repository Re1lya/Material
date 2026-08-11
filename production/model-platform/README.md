# Model platform production bootstrap

This directory contains the first production-safe, NPU-free slice of the model
platform:

- `base.yaml` creates the `model-serving` namespace and the tokenless
  `model-cache` ServiceAccount.
- `catalog/` freezes the first Qwen ModelVersion and its certified runtime
  profile.
- `cache/` contains the resumable, checksum-validating ModelCache fetcher and
  the first A3 prefetch Job.
- `gitea/` contains the independent production Gitea storage and Helm values;
  credentials are deliberately provisioned outside Git.
- `argocd/` contains the production Argo CD Helm values, the locked-down
  default project, and the deployment acceptance record.
- `gitops/` contains the isolated namespace, least-privilege AppProject,
  manually synchronized Application, initial Gitea repository tree and the
  first end-to-end acceptance record.
- `tekton/` contains the pinned, internal-registry-only Tekton Operator,
  Pipelines, Triggers, and the first NPU-free Gitea-to-validation CI loop.
- `crossplane/` contains the pinned Crossplane Core release, the production
  acceptance record, and the established namespaced `ModelDeployment` XRD.
  It deliberately contains no composite resource instance or runtime workload.

The ModelVersion documents are Git catalog objects. They are not applied to
Kubernetes until the corresponding platform CRDs exist.

The cache Job must not be applied until the namespace contains a Secret named
`artifact-keeper-model-runtime` with a `token` key holding a repository-scoped,
read-only Artifact Keeper token.

The Job intentionally requests no `huawei.com/Ascend910` resources. It writes
to a staging directory, verifies every file and the canonical manifest, then
atomically renames the directory and writes `READY`.
