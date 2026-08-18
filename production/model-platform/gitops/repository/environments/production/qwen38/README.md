# Qwen3.8 release input (not yet an Argo path)

This directory is the hand-off contract for the first ModelScope/Ray release.
It is deliberately outside the current Argo Application path
(`environments/production/modeldeployments`) until the ModelScope revision,
Artifact Keeper manifest digest, cache image digest, runtime image digest and
StorageClass evidence are complete.

The three `*.template.yaml` files are examples for generating the real Gitea
objects. They are not valid production releases while they contain angle
bracket values and are never selected by Argo or Tekton. After the CPU-only
importer prints its immutable manifest, generate:

```text
environments/production/catalog/qwen3.8-27b-w8a8.yaml
environments/production/catalog/qwen38-w8a8-ray-ascend-910b3-v1.yaml
environments/production/modeldeployments/qwen38-27b.yaml
```

The ModelVersion records the BF16 ModelScope source, the ModelSlim provenance and
the final W8A8 Artifact Keeper path. The RuntimeProfile records the ARM64/Ray
image, cache image, model path and 8-NPU worker contract. The ModelDeployment
repeats only the immutable values that Crossplane needs to render; Tekton rejects
any mismatch with the catalog.

The quantizer is a separate, NPU-capable build job. It reads the immutable BF16
source from Artifact Keeper and publishes a new immutable W8A8 prefix; it is not
created by the Ray Composition and is not scheduled on `gpu-server-00` during
the current control-plane-only phase.

The cache Job reads `manifest.json` from Artifact Keeper after authenticating
with the runtime read-only Secret. No manifest ConfigMap, model bytes or
ModelScope token is sent through Git, Argo or Crossplane.

Initial release state must be `desiredState: Stopped` and
`runtime.workerReplicas: 0`. Only after the cache Job has read back and
validated `READY` may a separate reviewed commit set both to `Running` and
`1`. This directory is not copied to Gitea main by this change.
