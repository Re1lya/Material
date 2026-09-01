# Zero-resource Stop regression recovery — 2026-09-01

## Regression chain

Changing `qwen38-27b` from the Ray Composition to a dedicated stopped
Composition exposed three contracts that still assumed stopped runtime
resources remained present:

1. `function-patch-and-transform` rejected `resources: []`, leaving the XR
   `Synced=False`;
2. the Running capacity gate required the deleted cache Job to be Complete and
   the Start/Stop auto-merge policies did not project Composition changes;
3. the production XRD required `spec.runtime.serving`, while the production
   RuntimeProfile, request files and Backstage request generator still omitted
   it.

## Recovered contract

- Stopped retains only `qwen38-27b-status`, a status-only ConfigMap declaring
  runtime/cache disabled and NPU requested zero.
- RayService, RayCluster, Pods, Services, PVC, cache Job and NetworkPolicy are
  removed while stopped.
- Start changes both Composition references from
  `modeldeployment-stopped-v1alpha1` to
  `modeldeployment-qwen38-ray-v1alpha1`; Stop performs the inverse transition.
- The capacity gate validates the stopped XR, immutable profile/cache/artifact
  contract, Kubernetes claims and physical NPU telemetry. It no longer requires
  a cache Job that is intentionally absent while stopped.
- The Ray Composition recreates the cache PVC/Job. Head and worker Pods retain
  the existing READY-file init gate before model startup.
- `runtime.serving` is now present in the certified RuntimeProfile, production
  requests, JSON schemas, validator and Backstage request generator.

## Production Gitea provenance

`gitadmin/model-platform-config`:

- PR #33 / commit `2d2b833a9d256799c6931dcfb4a4e8c4d81a0c6d`: valid stopped
  Composition and its CI policy;
- PR #34 / commit `0ded670d8326f2b4ab5ca235714e6d6df7f5ce52`: generation 17
  Running gate and lifecycle merge policy source/tests;
- PR #35 / commit `4745feae60dfdc751928bd78b8fd8d85e6fa5134`: structured
  serving contract restoration.
- PR #36 / commit `5cd5b49d194fcc31d6a28f2ec42cf78df52dced0`: exact-PV
  retained cache reclaim before Start merge.

`gitadmin/platform-backstage`:

- `49ffff6b8c0309e869a68304881fabfb26c3d40e`: stopped/Ray Composition
  Start/Stop switching;
- `3375d3a12f6a0f0875b79d1778d996e62bd2361a`: preserve structured
  serving fields when generating requests.

## Production state

- Tekton `validate-model-platform-config` generation: 18 after installing the
  retained-PV reclaimer task.
- Running Window remains explicitly open for the user-approved acceptance.
- Backstage image:
  `0.6.1.2-serving-contract-hotfix-20260901@sha256:48ec0a673d565dc93fa1cd3460cc91727da99b295d964c2b02e4971fc3d5a0ac`.
- PR #32 passed all six tasks and merged as
  `5b37fae62493857139a535541051760dd63b8fca`.
- Argo accepted the corrected Running request with `runtime.serving` and the XR
  entered Running/Synced/Ready. Cache, Ray and Pod resources were recreated.
- The retained PV was safely rebound without deleting its local cache. The
  cache Job completed and fresh Ray head/worker Pods entered Running on
  `a3-server-00`.

The Model Deployment Dashboard candidate was not applied during this recovery.
