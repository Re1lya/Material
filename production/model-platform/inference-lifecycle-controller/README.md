# Inference lifecycle controller

This controller closes the KubeRay v1.6.0 lifecycle gap observed during the
2026-08-31 Qwen acceptance. KubeRay's RayService hash deliberately excludes
worker replica changes, so an existing head-only RayCluster is not expanded on
Start and an existing running RayCluster is not reduced on Stop.

The controller is deliberately narrow:

- it watches only `model-serving` and an explicit deployment allow-list;
- the ModelDeployment must opt in with
  `platform.example.com/lifecycle-controller: enabled`;
- the certified Qwen Ray Composition, ModelDeployment conditions and
  RayService worker contract must already match the desired lifecycle state;
- exactly one RayCluster must carry the deployment labels and a controller
  ownerReference matching the RayService UID;
- after a grace period it deletes that RayCluster with a UID precondition;
- KubeRay remains responsible for recreating the RayCluster;
- a reconciliation marker prevents repeated deletion for the same
  ModelDeployment/RayService generation.

The controller never creates or patches a ModelDeployment, RayCluster Pod,
RayService spec, NPU resource, Secret or cluster-scoped object.

The `model-platform-system/artifact-keeper-platform-pull` Secret is created
out of band from the existing read-only `ci-image-reader` pull identity. It is
not rendered in this directory and no credential data is stored in Material.

The production manifest is pinned to the verified AMD64 Artifact Keeper image
`platform/inference-lifecycle-controller:0.1.0-20260831` at digest
`sha256:43ab0d606ee89426fe2b18725f6804331b87b62a3f6f3ac64abc639bcbae23b6`.
