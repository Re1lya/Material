# Model platform production bootstrap

This directory contains the first production-safe, NPU-free slice of the model
platform:

- `base.yaml` creates the `model-serving` namespace and the tokenless
  `model-cache` ServiceAccount.
- `catalog/` freezes the first Qwen ModelVersion and its certified runtime
  profile.
- `importer/` contains the CPU-only, immutable-revision ModelScope BF16 source
  importer; the Qwen3.8 release contract also requires an isolated ModelSlim
  W8A8 quantization job to publish a second immutable Artifact Keeper prefix.
  `cache/` contains the resumable, checksum-validating ModelCache fetcher and
  the first A3 prefetch Job. The new Qwen3.8 cache image reads the final
  W8A8 Artifact Keeper `manifest.json` sidecar and is not yet built or released.
- `gitea/` contains the independent production Gitea storage and Helm values;
  credentials are deliberately provisioned outside Git.
- `artifact-keeper/` contains the synchronized Artifact Keeper Helm chart
  source and the current non-secret POC values snapshot; the synchronization
  record and source provenance are in `artifact-keeper/README.md`.
- `argocd/` contains the production Argo CD Helm values, the locked-down
  default project, and the deployment acceptance record.
- `gitops/` contains the isolated namespace, least-privilege AppProjects,
  manually synchronized Applications, initial Gitea repository tree, strict
  ModelDeployment CI policy and the first end-to-end acceptance record.
- `tekton/` contains the pinned, internal-registry-only Tekton Operator,
  Pipelines, Triggers, the first CPU-only Gitea-to-validation CI loop and the
  production-grounded FastAPI deployment/CI/CD design. FastAPI remains a plan;
  no FastAPI cluster object has been released.
- `crossplane/` contains the pinned Crossplane Core release, production
  acceptance records, namespaced `ModelDeployment` XRD, locked Composition
  Function and the released runtime-zero Composition. The new
  `crossplane/foundation/` control-plane-only Kustomization contains the
  provider-kubernetes ServiceAccount/RBAC/RuntimeConfig, XRD and reusable
  Qwen3.8 Ray Composition source. The provider-kubernetes package is now
  installed from an Artifact Keeper immutable digest and the namespaced
  `model-serving` ProviderConfig is validated; the provider only has the
  reviewed target-namespace permissions. Its current proof instance owns only
  a control-plane status object and creates no model Pod or NPU allocation.
- `backstage/` contains the repository-owned Backstage application, constrained
  Gitea-PR template, immutable input locks, dedicated PostgreSQL/local-PV
  manifests, namespace-scoped read-only Kubernetes RBAC and the release
  runbook. Production Backstage is now running as v0.2.11 from the locked
  Artifact Keeper digest; the manifests and release record are the source of
  truth for that deployed state.
- `backstage/artifact-management-mvp-20260819.md` records the local-only MVP for
  restricted Artifact Keeper repository/token management and the dedicated
  Tekton chunked-publish/status lane. It is deliberately gated behind HTTPS,
  namespace-local Secrets and an approved staging PVC.
- `monitoring-status-20260819.md` records the current read-only production
  monitoring inventory and the Prometheus/NPU exporter snapshot for
  `a3-server-00` and the 910B3 `gpu-server-*` pool. It is an observation and
  capacity-review aid, not an automatic NPU scheduler or deployment approval.
- `qwen38-ray-mvp-plan-20260818.md` is the focused execution plan for the
  Qwen3.8-27B ModelScope source, the one-time compatibility smoke test on
  `gpu-server-00`, and Argo CD → Crossplane Composition → KubeRay
  platformization. The smoke uses the final release unit and is not a disposable
  POC; it supersedes the older Qwen3.6/A3-first execution order for this task
  and does not claim that Qwen3.8 or a RayService is deployed.
- `qwen38-ray-tp2-deployment-and-capacity-plan-20260819.md` is the approved
  TP=2/DP=1 Profile contract, Docker-to-Ray parameter mapping, chip semantics,
  deployment gate and 32K capacity test record. It is a plan and evidence
  boundary only; it does not authorize an Argo sync or NPU workload.
- `gitops/repository/environments/production/qwen38/` holds the non-active
  catalog/XR templates. They remain outside the current Argo path until a
  real ModelScope revision and immutable Artifact Keeper/runtime/cache digests
  are verified.

The ModelVersion documents are Git catalog objects. They are not applied to
Kubernetes until the corresponding platform CRDs exist.

The cache Job must not be applied until the namespace contains a Secret named
`artifact-keeper-model-runtime` with a `token` key holding a repository-scoped,
read-only Artifact Keeper token.

The Job intentionally requests no `huawei.com/Ascend910` resources. It writes
to a staging directory, verifies every file and the canonical manifest, then
atomically renames the directory and writes `READY`.

## Image registry policy

The environment has two image registries:

- `110.120.0.3:30670/container-images` is the Artifact Keeper Docker-format
  repository and is the destination for all new images owned by this integrated
  platform.
- `110.120.0.3:8889` is the legacy Docker Distribution registry. Existing
  digest-pinned workloads continue using it until each consumer is migrated and
  verified independently; its tags and content must not be removed.

`server-00` K3s containerd was registered for the Artifact Keeper internal HTTP
endpoint on 2026-08-13. On 2026-08-14 a disposable Pod successfully performed
an authenticated pull by immutable digest and ran on `server-00`. Backstage,
Crossplane and `model-platform-ci` now each have a namespace-local,
repository-scoped read-only pull Secret (the CI Secret is
`artifact-keeper-image-pull`). On 2026-08-17 the live Tekton validation Steps
and status reporter migrated to the Artifact Keeper digest and passed a full
validation Run; the former 8889 digest remains the rollback reference. Other
worker nodes have not been registered for this HTTP endpoint, so constrain
new FastAPI CI/runtime consumers to `server-00` until each required node passes
the same test. See
`artifact-keeper-registry-registration-20260813.md` for evidence and rollback
information.
