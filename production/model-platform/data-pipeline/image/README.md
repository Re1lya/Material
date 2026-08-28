# K12 data-pipeline image build contract

> **Historical/superseded build material.** The empty Definitions image was a
> safety probe and is not the current K12 production image or future release
> path. It is retained for build reproducibility and incident/design review;
> do not publish or deploy it as the active K12 control plane.

This directory contains the platform-owned derivative Dockerfile for the
Dagster control plane. It is built from the upstream KCC source commit
`2fd605cfe572470f582c4ef9575a5382dd6f9ff2` and is not a Kubernetes manifest.

The build context must contain only:

```text
Dockerfile
src/                 # from app/data_pipeline at the pinned commit
config/              # from app/data_pipeline at the pinned commit
platform_control_plane/ # platform-owned safe Dagster Definitions location
wheelhouse/          # flattened runtime wheels (including approved Pillow/pypdfium2)
```

The base image is the internal AMD64 Dagster/Ray image documented in the
platform adaptation plan. Build with `--network=none`. It deliberately adds no
NPU libraries, Kubernetes credential, Secret, host path or runtime resource.

Publishing destination is Artifact Keeper's Docker repository:
`110.120.0.3:30670/container-images/k12-data-pipeline-dagster`.
The release record must contain the Registry manifest digest and confirmed
`linux/amd64` architecture, never the publisher credential.

The first safe control-plane image is
`0.3.0-control-plane@sha256:c5f80cd6f09becb3493745416f2020ebc3f667f904ff5c8e477be5f524b1e5ba`.
It was built with `--network=none`, verified to expose an empty Dagster
location, and has no Kubernetes consumer yet.
