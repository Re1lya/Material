# ModelDeployment requests

Backstage creates one YAML file per request in this directory on a short-lived
branch, then opens a Gitea pull request. During the mock fixed-runtime phase,
the form records requested TP/PP/replicas/priority as constrained annotations,
but the Kubernetes spec remains `Stopped` with `acceleratorPool:
control-plane-only`. The effective values are explicitly recorded as the fixed
Qwen profile, TP=6, replicas=0 and NPU=0.

No file should be edited directly on `main`. A merge records desired state but
does not apply it: Argo CD automated sync, prune and self-heal remain disabled.
