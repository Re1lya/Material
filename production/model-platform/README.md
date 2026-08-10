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

The ModelVersion documents are Git catalog objects. They are not applied to
Kubernetes until the corresponding platform CRDs exist.

The cache Job must not be applied until the namespace contains a Secret named
`artifact-keeper-model-runtime` with a `token` key holding a repository-scoped,
read-only Artifact Keeper token.

The Job intentionally requests no `huawei.com/Ascend910` resources. It writes
to a staging directory, verifies every file and the canonical manifest, then
atomically renames the directory and writes `READY`.
