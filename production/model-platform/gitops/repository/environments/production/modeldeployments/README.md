# ModelDeployment requests

Backstage creates one YAML file per request in this directory on a short-lived
branch, then opens a Gitea pull request. During the mock fixed-runtime phase,
the form records requested TP/PP/replicas/priority as constrained annotations,
but the Kubernetes spec remains `Stopped` with `acceleratorPool:
control-plane-only`. The effective values are explicitly recorded as the fixed
Qwen profile, TP=6, replicas=0 and NPU=0.

No file should be edited directly on `main`. A merge records desired state but
does not apply it: Argo CD automated sync, prune and self-heal remain disabled.

The control-plane-only mock described above is not the Qwen3.8 runtime release.
For that task, use `production/model-platform/qwen38-ray-mvp-plan-20260818.md`
and the non-active templates in `../qwen38/`: ModelScope importer output first
becomes an immutable Artifact Keeper artifact, then Tekton validates the
catalog/XR, Argo CD submits the `ModelDeployment` XR, Crossplane's reviewed
provider/Composition creates the cache and RayService, and KubeRay owns the
Ray lifecycle. The current repository change installs none of those runtime
objects and makes no write to `gpu-server-00`. Do not copy a template into this
directory until the real revision/digests and node-local StorageClass evidence
are present.
