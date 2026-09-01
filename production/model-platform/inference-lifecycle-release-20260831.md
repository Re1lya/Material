# Inference lifecycle automation release preparation — 2026-08-31

> Status: formally released after production server-side dry-run and explicit
> approval. The platform remains Stopped/worker 0 with zero NPU.

## Release contents

- Backstage Start action now updates an existing Gitea file with `PUT` and its
  current SHA.
- Backstage exposes state-aware Start/Stop buttons and a constrained Stop
  Scaffolder action/template.
- Tekton Pipeline generation 16 adds strict automatic merge for a single
  `Running -> Stopped` ModelDeployment update and gives open Stop requests
  priority over new Running requests.
- The inference lifecycle controller recreates only a stale RayCluster that is
  owned by the allow-listed RayService and protected by an exact UID
  precondition.
- `qwen38-27b` opts into lifecycle control while remaining Stopped/worker 0.

## Published images

Both images were built on AMD64 `server-00`, pushed to Artifact Keeper and
inspected as `linux/amd64`:

```text
110.120.0.3:30670/container-images/platform/kcc-backstage:0.5.8-inference-lifecycle-20260831
@sha256:a41e12af52aa047bbb41b291ae48058c393c4d071bc9bd5d45241b43dde4b2d5

110.120.0.3:30670/container-images/platform/inference-lifecycle-controller:0.1.0-20260831
@sha256:43ab0d606ee89426fe2b18725f6804331b87b62a3f6f3ac64abc639bcbae23b6
```

Registry credentials were removed with `docker logout` after publication.

## Build and release evidence

The minimal release directory is retained on `server-00` at:

```text
/tmp/model-platform-inference-release-20260831-OOrLwn
```

The copied contexts and dry-run bundle passed their SHA256 manifests. The
reviewed dry-run bundle contains only:

- Backstage Deployment manifest;
- Tekton Pipeline manifest;
- lifecycle controller SA/RBAC/Deployment/NetworkPolicy;
- ModelDeployment JSON Schema;
- `qwen38-27b` GitOps request with lifecycle opt-in.

## Production dry-run result

The following commands passed against the production K3s API:

```text
Backstage: deployment configured (server dry run)
Tekton: validate-model-platform-config configured (server dry run)
Controller: SA, Role, RoleBinding, Deployment and NetworkPolicy created (server dry run)
Qwen ModelDeployment: configured (server dry run)
```

The Backstage diff changes only the image from the live 0.5.7 digest to the
0.5.8 digest. The Tekton diff advances generation 15 to the reviewed generation
16 logic. The Qwen dry-run adds the lifecycle opt-in; it must enter production
through Gitea/Argo and must not be applied directly because Argo owns the live
tracking annotation.

Post-dry-run verification confirmed that production remained unchanged:

- no inference lifecycle controller Deployment exists;
- Backstage still runs the 0.5.7 image;
- Tekton Pipeline remains generation 15;
- Qwen remains Stopped/worker 0 without the lifecycle opt-in annotation.

## Reviewed formal release order

After explicit approval:

1. Apply the Tekton Pipeline generation 16 manifest.
2. Apply the lifecycle controller resources; before GitOps opt-in it remains
   inert for Qwen.
3. Commit the schema and Qwen lifecycle annotation to production Gitea, wait
   for validation and Argo auto-sync, and confirm Stopped/worker 0 remains
   unchanged.
4. Roll Backstage to the pinned 0.5.8 image and verify health, catalog,
   deployment status API and registered Start/Stop actions.
5. With the Running window still closed, click Start once as a negative UI
   gate test. Close the rejected PR/branch.
6. Open a controlled Running window and perform the positive UI
   Start -> inference -> Stop acceptance. No manual RayCluster deletion should
   be required.

## Formal production release

The approved release completed in the reviewed order:

1. Tekton `validate-model-platform-config` advanced from generation 15 to 16
   and exposes `auto-merge-stop-request` alongside the existing tasks.
2. `model-platform-system/inference-lifecycle-controller` rolled out 1/1 Ready
   on `server-00`. Its image was pulled by a namespace-local Secret copied from
   the existing read-only `ci-image-reader` identity; the historical Secret
   annotation was not copied.
3. Production Gitea commit
   `37df82c33d3b4afd29b7d6ac78a143449f88fb66` added only the schema property
   and Qwen lifecycle opt-in. PipelineRun
   `model-platform-config-validation-j8d86` completed successfully, and Argo
   auto-synced the exact commit.
4. Backstage rolled to the pinned 0.5.8 image, became 1/1 Ready and registered
   both `model-platform:gitea-start-inference-pr` and
   `model-platform:gitea-stop-inference-pr`.

Acceptance after release:

- Backstage `/healthcheck`, `/model-recipes` and
  `/api/model-platform/deployments` returned HTTP 200;
- the status API reported `qwen38-27b` as Stopped;
- the lifecycle controller reported that the RayCluster worker contract
  matched expected workers 0;
- the Qwen RayCluster UID remained unchanged, proving the controller performed
  no unnecessary deletion;
- K12 Dagster/Ray, DS, ray-demo and KubeRay operator Pod UIDs and restart
  counts remained unchanged;
- A3 had no Kubernetes NPU claim and Prometheus reported no NPU processes.

The remaining acceptance is user-driven UI testing: first a window-closed
negative Start, followed by the controlled positive Start -> inference -> Stop
sequence.
