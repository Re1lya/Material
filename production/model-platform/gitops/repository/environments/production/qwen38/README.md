# Qwen3.8 release input and stopped Argo path

This directory is the hand-off contract for the first ModelScope/Ray release.
The first submitted XR uses `modeldeployment-control-plane-v1alpha1`; that
Composition records the complete release contract without creating a PVC, Job,
RayService, Service or physical-node selection. A later reviewed transition to
`modeldeployment-qwen38-ray-v1alpha1` is the only step that may materialize the
cache and Ray objects.

The stopped request and catalog are published in the Gitea
`model-platform-config` `main` branch. Commit `45460d9748e116e0b8c8633c64aa1459e9d8d2d0`
contains the release objects; follow-up commit
`6fdb3022b791d56cc1cba3a14fce0aca64eec7cf` publishes the Ray-capable RuntimeProfile
schema used by CI. Argo CD tracks the branch through the manually-synced
`model-platform-deployment-requests` Application and is currently synced at the
follow-up commit. Crossplane's internal composition selector is explicitly
pinned to `modeldeployment-control-plane-v1alpha1`; the user-facing
`compositionRef` is therefore not allowed to select a runtime composition during
this stage.

The three `*.template.yaml` files are examples for generating the real Gitea
objects. They are not valid production releases while they contain angle
bracket values and are never selected by Argo or Tekton. After the CPU-only
importer prints its immutable manifest, generate:

```text
environments/production/catalog/qwen3.8-27b-w8a8.yaml
environments/production/catalog/qwen38-w8a8-ray-ascend-910b3-v1.yaml
environments/production/modeldeployments/qwen38-27b.yaml
```

The ModelVersion records the ModelScope source (or the explicitly marked
`a3-preloaded` source when an already-quantized A3 snapshot is imported), the
ModelSlim provenance and the final W8A8 Artifact Keeper path. The RuntimeProfile
records the ARM64/Ray image, cache image, exact container model path
`/models/Qwen3.8-27B-w8a8` and 8-NPU worker contract. The ModelDeployment repeats
only the immutable values that Crossplane needs to render; Tekton rejects any
mismatch with the catalog.

The imported release currently uses the A3 snapshot with ModelScope revision
`e823e888ae179eb3be02c1a48899c4f828371376` and the following immutable Artifact
Keeper values:

```text
model prefix:    qwen3.8-27b/w8a8/e823e888ae179eb3be02c1a48899c4f828371376/msmodelslim-w8a8-a3-f2afa9e2
files / bytes:   26 / 32152070926
manifest digest: sha256:f2afa9e2f328d9efb78bc88d526413783304c4706a508f0da1db456aeac5c20f
runtime image:   sha256:a27a79c2021cdda071eb207c169a5dd44537d22df11ccd7b62b52de117ceac14
cache image:     sha256:2c38a8bb8be05414a5afebdd88fde3c2032098d0d1edb3f3e005f0adb6d78e13
```

All 26 files and the manifest were uploaded with Artifact Keeper's resumable
64 MiB chunk API and verified by metadata and manifest digest read-back. The
runtime image was copied as an OCI manifest and all 16 manifest/config/layer
blobs were verified. The direct multi-gigabyte upload path is intentionally not
used because it previously exhausted the Artifact Keeper backend memory limit.

The quantizer is a separate, NPU-capable build job. It reads the immutable BF16
source from Artifact Keeper and publishes a new immutable W8A8 prefix; it is not
created by the Ray Composition and is not scheduled on `gpu-server-00` during
the current control-plane-only phase. The supplied A3 directory is already the
final W8A8 output, so its catalog entry records `a3-preloaded` and does not
invent a BF16 input artifact or calibration digest that was not provided.

The cache Job reads `manifest.json` from Artifact Keeper after authenticating
with the runtime read-only Secret. No manifest ConfigMap, model bytes or
ModelScope token is sent through Git, Argo or Crossplane.

Initial release state must be `desiredState: Stopped` and
`runtime.workerReplicas: 0`. Only after the cache Job has read back and
validated `READY` may a separate reviewed commit set both to `Running` and
`1`. The currently synced XR has only the control-plane status ConfigMap; there
is no Qwen3.8 PVC, cache Job, RayService, Service, Deployment, Pod or NPU
request. Existing A3 Docker services and their NPU chips were not changed.
