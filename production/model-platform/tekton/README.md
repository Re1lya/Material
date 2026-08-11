# Tekton production bootstrap

This directory prepares the first production CI control plane for the model
platform. It is intentionally NPU-free and does not build images, download
models, write Git, or ask Argo CD to synchronize. Its first job is narrower:
receive a trusted Gitea `main` push, clone that exact commit, and run the
repository's bootstrap validation.

## What "single replica" means

This does not create another Kubernetes cluster. Tekton is installed into the
existing K3s cluster. `single replica` means that each Tekton controller,
webhook, interceptor, and EventListener has one Pod. Those Pods are pinned to
the existing amd64 management node `server-00`; PipelineRun Task Pods are also
pinned there for this first stage.

The platform can be expanded by updating the Operator custom resources and
the CI manifests. Adding replicas, Results, Pruner, Chains, another listener,
or worker-node Task placement is an in-place reconciliation, not a rebuild.
Making the K3s control plane itself highly available is a separate K3s change
and is not performed here.

## Components

- Tekton Operator `v0.81.0` owns installation and later component upgrades.
- Tekton Pipelines `v1.15.0` reconciles PipelineRuns into TaskRun Pods.
- Tekton Triggers `v0.37.0` turns an accepted Gitea webhook into a PipelineRun.
- The CEL core interceptor accepts only a `push` to the expected repository's
  `main` branch.
- `model-platform-ci` isolates the listener, Pipeline, ServiceAccounts,
  ResourceQuota, LimitRange, and NetworkPolicies.
- `model-platform-ci-tools` combines the pinned internal Alpine Git and
  kubectl images. The Pipeline uses those tools to run an offline POSIX
  Kustomize and structure validation without mounting a Kubernetes API token.

The Operator is used deliberately: component versions and optional additions
remain declarative and upgradable. Its cost is a wider cluster-level surface:
the upstream release installs 14 Operator CRDs plus the RBAC needed to manage
Tekton component CRDs, admission webhooks, and controllers. Only
`TektonPipeline` and `TektonTrigger` instances are created in this stage.

## Steady resource envelope

The planned steady state is approximately 10 small Pods and 1.1 CPU / 1.3 GiB
of requests, including the EventListener and Operator proxy webhook. Limits
are higher but do not reserve CPU. A validation PipelineRun is on demand and
requests 250m CPU / 256 MiB memory while it runs. No PVC is created.

Remote resolvers are disabled and their Deployment is scaled to zero. Results,
Pruner, Chains, Dashboard, Pipelines-as-Code, model cache, image build, and NPU
tasks are outside this stage.

## Files and ownership

- `versions.lock.yaml` freezes upstream release URLs and SHA-256 hashes.
- `images.lock` maps immutable upstream images to the internal registry.
- `mirror-images.sh` verifies each upstream multi-architecture index digest,
  resolves the locked `linux/amd64` child manifest, then uses Docker to pull
  that platform and push it into the internal registry. Existing targets with
  the correct digest are skipped. `GHCR_PROXY_HOST` may select a transport
  mirror such as `ghcr.dockerproxy.net`; both the index and amd64 child digests
  must still match `images.lock` before any pull, and the pushed target digest
  is verified again.
- `operator/` vendors the verified upstream Operator manifest and applies
  local image, scheduling, resource, and Pod Security patches.
- `system-namespaces.yaml` and `components.yaml` define the Pipeline and
  Trigger installation without a broad `TektonConfig` profile.
- `ci/` defines the constrained validation loop.
- `ci-tools/` builds the validation image.

The CI image reference in `ci/pipeline.yaml` is fixed as
`v0.1.0@sha256:3a00ce72a200713e82768821d2caffa6644f47725ba34793b2f4859d71565785`.
A tag-only reference remains a release blocker for future updates.

## Trust and access boundaries

- All runtime images must come from `110.120.0.3:8889` and remain pinned by
  digest.
- The Gitea reader token is created out of band as Secret
  `model-platform-ci/gitea-ci-reader`; no credential belongs in Git.
- The runner ServiceAccount does not mount a Kubernetes API token.
- The listener can read only its Trigger objects, impersonate only the runner,
  create PipelineRuns, and read the cluster-wide CEL interceptor definition.
- NetworkPolicy permits DNS, the Kubernetes API, Gitea HTTP, the Gitea-to-
  listener request, and listener-to-interceptor TLS. Other ingress and egress
  are denied.
- Webhook source is restricted by NetworkPolicy in this first stage. A signed
  webhook/interceptor should be added before exposing the listener beyond the
  cluster-internal Gitea path.
- Windows Task execution is unsupported. The Operator's Windows shell image
  setting intentionally points at the pinned Linux shell because this cluster
  contains no Windows nodes.

## Release sequence and gates

Production writes are separated into explicit gates:

1. Mirror the locked upstream images, build the CI tools image, record its
   digest, and render again. This writes only to the existing registry.
2. Apply the Operator manifest. This creates the `tekton-operator` namespace,
   14 CRDs, cluster-scoped RBAC, admission webhooks, and two Operator Pods.
3. Wait for Operator readiness, apply the system namespaces and component CRs,
   and wait for Pipeline and Trigger readiness.
4. Server-side dry-run the CI resources now that their CRDs exist.
5. Provision the read-only Gitea account/token Secret, apply the CI resources,
   configure the internal Gitea webhook, and run one non-NPU validation push.

Any failed gate stops the sequence. CRDs are not deleted during rollback.
Component CRs and CI objects can be removed separately, but CRD deletion is a
distinct destructive operation because it can remove all corresponding custom
resources.

## Expansion path

Normal upgrades update `versions.lock.yaml`, refresh the vendored manifest and
digests, validate the rendered diff, mirror the new images, then apply updated
CRs. Existing PipelineRuns and CI definitions do not require a cluster rebuild.
When workload grows, first move Task Pods to labelled CPU workers, then raise
controller replicas and budgets. Results and Pruner can be added as individual
Operator CRs only when their persistence and retention policies are designed.
