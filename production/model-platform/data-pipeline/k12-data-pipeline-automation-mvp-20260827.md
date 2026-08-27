# K12 数据管线自动化 MVP 路线

**状态：本地实现与清单验证中；未部署新版 Dagster、未创建 namespace/PV/PVC/Secret、未修改旧 `k12`。**

本文把“开发者改代码后能自动发布”和“使用者在 Backstage 发起一次数据处理、在
Dagster 中观察它”拆成两条明确且安全的链路。它们共享同一个已批准的镜像与数据
合同，但不能互相绕过权限边界。

## 1. 2026-08-27 基线和容量结论

对 `server-00` 的只读复核结果：

| 项目 | 观测值 | 结论 |
| --- | --- | --- |
| 可分配 CPU / 已请求 | 64 CPU / 29.8 CPU（46%） | 可容纳新的 750m 请求 |
| 可分配内存 / 已请求 | 约 754 GiB / 52.0 GiB（6%） | 可容纳新的 1792Mi 请求 |
| 实际 node 使用 | 约 4 CPU、57 GiB 内存 | 控制面不是当前热点 |
| `/mnt/data` | 7.0 TiB，总余量约 1.6 TiB（78% 已用） | 20Gi Dagster 状态 PV 有余量；不存放原始数据或模型 |
| 旧 `k12/mineru-dagster` | 2/2 Running，0 restart | 保持不动 |
| 新 `k12-data-pipeline` | 不存在 | 本轮未创建任何生产对象 |

节点的 CPU **limit** 已累计 83%，所以不能把“有空闲”误解为允许无边界扩容。本 MVP
为新控制面加了以下硬边界：低优先级、`preemptionPolicy: Never`、请求总额 1 CPU / 2Gi
的 namespace 配额、Pod 上限 2、`requests.huawei.com/Ascend910: 0`。它没有 Ray、NPU、
HostPath 源码、NodePort、Job、CronJob 或 Kubernetes write RBAC。

`model-serving/qwen38-27b-cache-job` 的 Job immutable-spec warning 和历史
`model-platform-ci` 已结束 TaskRun 的 pod-not-found warning 与本数据管线无关；本路线
不触碰、不重启、不清理它们。

## 2. 最小可用架构

```text
K12 source repository in Gitea
  └─ push / PR
      └─ Tekton K12 CI (tests, safe definitions import, Helm/policy render)
          └─ build AMD64 image offline -> Artifact Keeper container-images@digest
              └─ Gitea GitOps release PR -> approved sync -> new Dagster definition version

Backstage signed-in user
  └─ only chooses an allow-listed staging manifest and cpu-staging-v1 profile
      └─ narrow Backstage backend API
          └─ Dagster GraphQL launchRun for the already-active CPU-only job
              └─ Dagster daemon/run history -> Backstage read-only status page

MinIO k12-lake
  └─ only a new staging prefix and a non-root prefix-scoped credential
```

The Gitea route is a **code release** route. The Backstage route is a **data
run** route. A source-code push must not silently process data or allocate
NPU; a data-run request must not build arbitrary source code or write Kubernetes
objects.

## 3. Why the current upstream Definitions cannot be exposed unchanged

The fixed KCC commit `2fd605cfe572470f582c4ef9575a5382dd6f9ff2` includes
historical `clean_qa.mineru_dagster` jobs/resources that submit Ray jobs and
contain Qwen/MinerU lifecycle logic. It is useful source material, but it is
not an acceptable first Backstage execution target.

The first control-plane image therefore loads only
`platform_control_plane.definitions`, a platform-owned empty Dagster location.
It proves webserver/daemon/persistence/observability without exposing an
executable job. The reviewed replacement is now published as
`0.3.0-control-plane@sha256:c5f80cd6f09becb3493745416f2020ebc3f667f904ff5c8e477be5f524b1e5ba`;
the prepared foundation is pinned to that digest. The older `0.2.0-2fd605c`
image still loads the upstream location and remains forbidden for an apply.

The next image adds exactly one new `cpu-staging-v1` job. Its run config must
accept only a manifest under `s3://k12-data-pipeline-staging/`, use a separate
non-root S3 credential, and have no import of the legacy Ray/NPU resources.
Only after that job succeeds on a small staging batch may the Backstage run
button be enabled.

## 4. Delivery phases and acceptance gates

| Phase | Change | What it may do | What it must not do | Gate |
| --- | --- | --- | --- | --- |
| A | Build safe control-plane image | Artifact Keeper push only | Kubernetes mutation / NPU | immutable AMD64 digest + offline import proof |
| B | Apply CPU-only Dagster foundation | one webserver + daemon on `server-00` | S3 access, Ray, NPU, old K12 modification | rollout/health, zero NPU resource, unchanged old pod |
| C | Add K12 source CI | validate code and publish a reviewed image digest | write K8s, use NPU | Gitea PR status and Artifact Keeper pull evidence |
| D | Add `cpu-staging-v1` Dagster job | process a small staging manifest | historical NPU jobs or production prefixes | hashes, `_SUCCESS`, resume/failure checks |
| E | Enable Backstage run/monitoring | launch only `cpu-staging-v1`, list Dagster runs | arbitrary job selection / Ray / NPU | API contract, authorization, audit trail |
| F | Consider Ray/NPU | separate approved profile and runtime namespace | share existing cards/workloads | standalone capacity and ownership review |

Argo CD remains manual sync, `prune=false`, `selfHeal=false` throughout A–E.
Automation of GitOps synchronization is a later policy choice; it is not a
condition for the safe data-run API because that API talks only to a verified,
already deployed CPU job.

## 5. Backstage contract

The local Backstage module adds `/data-pipeline`, using the same page style as
the existing Artifact & CI management and model pages. Its backend endpoint is
authenticated and allows only `user:default/gitadmin` by default.

Initially it shows:

- immutable candidate image digest and source commit;
- readiness of the *new* Dagster foundation, never the legacy `k12` service;
- Dagster reachability and recent run summaries once the foundation exists;
- why execution is still disabled.

The implementation currently creates a bounded Git-only CPU staging request
PR as the audit-first intermediate contract. Before enabling a direct
`launchRun`, replace that handler with the phase-E narrow Dagster GraphQL call
and deploy only after `cpu-staging-v1` exists. In both forms the browser never
receives a Kubernetes credential, S3 credential, Artifact Keeper publisher
token or Dagster administrator secret.

## 6. CI and GitOps contract

Material now contains a schema and validator for a Git-only
`DataPipelineRunRequest`. The existing model-platform CI Pipeline has a new
read-only validation step. This is not yet a K12 source-code build pipeline:
the K12 repository must first be mirrored/imported into production Gitea and a
separate EventListener/Pipeline must be deployed for that exact repository.

That dedicated pipeline must:

1. accept only `gitadmin/k12-data-pipeline` (or the final reviewed name);
2. clone an exact 40-character commit;
3. run Python unit tests and import the safe Definitions;
4. render the K12 `production-safe` overlay and reject Ray/NPU/HostPath/root-S3;
5. use a pre-reviewed internal build executor to produce an AMD64 image;
6. push only to `110.120.0.3:30670/container-images` by immutable digest;
7. create a configuration PR, never mutate K3s directly;
8. report the exact commit status to Gitea.

The Build executor image and Gitea repository/import are intentionally not
created in this phase. They are the next reviewed preparation items, not a
reason to grant the existing Tekton runner Docker socket, privileged mode or
Kubernetes write permissions.

## 7. Current local validation evidence

- Backstage TypeScript: `corepack yarn tsc` passed.
- The request schema parsed with `python -m json.tool`; its validator compiled
  and passed with zero request files.
- Foundation Kustomize render contained 11 objects: Namespace, ResourceQuota,
  StorageClass, ServiceAccount, ConfigMap, Service, PriorityClass, PV, PVC,
  Deployment and NetworkPolicy.
- Client dry-run accepted all 11 objects. A server-side dry-run accepted the
  cluster-scoped PriorityClass. No namespace, PriorityClass or PV remained
  after validation.
- Deployment-only policy scan found no Ray, Ascend/NPU request, HostPath or
  NodePort. The sole `Ascend` reference is the intentional zero ResourceQuota
  guard, not a workload request.

## 8. Remaining prerequisites before any production apply

1. The safe control-plane image has been built/pushed and verified as AMD64:
   `0.3.0-control-plane@sha256:c5f80cd6f09becb3493745416f2020ebc3f667f904ff5c8e477be5f524b1e5ba`.
   The foundation and Backstage configuration are pinned to it.
2. Create the reviewed local PV directory on `server-00` with UID/GID 1000 and
   mode suitable for the non-root Dagster process.
3. Create only the namespace-local read-only Artifact Keeper pull Secret.
   The phase-B location has no S3 Secret at all.
4. Apply the dedicated Backstage read-only Role/RoleBinding together with the
   new namespace, then verify it still cannot create/patch anything.
5. Deploy the foundation through a reviewed Argo/GitOps path or one scoped,
   separately approved apply; observe it before introducing S3 or jobs.

No NPU experiment, Ray object, model-cache job, existing K12 Deployment
change, PVC migration or old Dagster cleanup is authorized by this document.
