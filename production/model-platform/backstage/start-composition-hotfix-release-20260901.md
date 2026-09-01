# Backstage Start/Stop Composition hotfix — 2026-09-01

## Cause

Production `qwen38-27b` correctly used the resource-free stopped Composition
`modeldeployment-stopped-v1alpha1`, while the Backstage 0.6.1 Start action still
required the Ray runtime Composition before it would create a Start PR. The
request was rejected before Gitea, Tekton, Argo CD or Kubernetes mutation with:

```text
Only a request bound to the certified Ray runtime composition can be started
```

## Fix and identity

- production source repository: `gitadmin/platform-backstage`;
- parent commit: `006ed295fbe3e3b22a96ecbb3c1dfcc41e70f3ec`;
- hotfix commit: `49ffff6b8c0309e869a68304881fabfb26c3d40e`;
- build-context SHA256:
  `9e7a48c4df0524ce3ece7aa3ff71eaf64ac1b4dbd2fa712250480475382bdfa2`;
- image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.1.1-start-composition-hotfix-20260901`;
- digest:
  `sha256:dcd4dfa7c333f90426399699f4a18114bff5a48fd7cbea079e2022b89ea6b19a`;
- architecture: `linux/amd64`.

Start now requires the certified stopped Composition and changes both
`spec.compositionRef` and `spec.crossplane.compositionRef` to
`modeldeployment-qwen38-ray-v1alpha1` in the generated PR. Stop performs the
inverse transition back to `modeldeployment-stopped-v1alpha1`. New stopped
requests use the stopped Composition by default.

## Production acceptance

- Backstage rolled out 1/1 Ready from the exact 0.6.1 image as its base;
- `/healthcheck`, `/kcc-pretraining`, `/model-recipes`, `/data-pipeline`,
  `/artifact-management` and `/api/model-platform/deployments` returned 200;
- the live image contains the corrected backend payload and stopped
  Composition configuration;
- `qwen38-27b` retained UID
  `660cfc0e-4f41-4763-bd44-34db485fd9c0`, remained Stopped with worker 0 and
  retained `modeldeployment-stopped-v1alpha1`;
- no model-serving Pod or cluster Pending Pod was created by the rollout;
- the Model Deployment Dashboard candidate was not applied.
