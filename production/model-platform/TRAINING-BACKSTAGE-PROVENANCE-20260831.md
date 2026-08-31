# 训练集成与 Backstage 源码保留基线（2026-08-31）

本文记录当前生产训练集成、Backstage 运行版本以及下次发布必须保留的源码
边界。它是构建/更新前的必读事实，不含任何密码、Token、Secret 或 kubeconfig。

## 1. 当前生产事实

### 训练侧

| 项目 | 观察结果 |
| --- | --- |
| API | `trainingrequests.platform.example.com` XRD Established；`trainingrequest-kcc-v1alpha1` Composition 已安装 |
| Controller | `kcc-training/kcc-kcc-training` 2/2 Ready，当前镜像为 `platform/kcc-training-controller:1.1.6-895f830@sha256:cc4633f8649b3c538c25cb108d00213d8fd8281ea079d521ed73c1cfbfb8805a` |
| 训练对象 | 已存在多个 TrainingRequest，均为 Synced/Ready；历史 TrainingRun 同时包含 `Succeeded`、`ManualRequired` 与 `Suspended` |
| Argo | `model-platform-training-system` 当前 `OutOfSync/Healthy`，并报告 10 个 orphaned resources；不得在未审查差异时全量 Sync |
| NPU | 本次盘点没有 TrainingRun 正在申请 NPU；训练 Controller 本身固定在 `server-00`，只使用 CPU/内存 |

训练 Application 的两个声明式 source 都在生产 Gitea：

```text
gitadmin/model-platform-config
  environments/production/training-system/kcc
  environments/production/training-system/platform-api
```

### Backstage

生产 Backstage 运行：

```text
110.120.0.3:30670/container-images/platform/kcc-backstage:0.5.9-kcc-merge-ca2b700@sha256:057988d8725b3b47ac5f4e6744e452884ef0b2c03725a69cf6baa76648d3fb59
```

Deployment 为 1/1 Ready；`/healthcheck`、`/kcc-pretraining`、
`/model-recipes` 和 `/data-pipeline` 都返回 HTTP 200。

### Artifact Keeper

以下当前生产镜像已通过认证 Registry manifest 检查，均位于 Artifact Keeper：

```text
container-images/platform/kcc-backstage:0.5.9-kcc-merge-ca2b700
container-images/platform/kcc-training-controller:1.1.6-895f830
container-images/platform/kcc-data-pipeline:0.5.0-npu-smoke-837fe220
```

镜像地址带 `110.120.0.3:30670` 和不可变 digest 的 Deployment 引用是生产
可执行事实；tag 仅用于人类识别，更新时必须继续固定 digest。

## 2. Gitea 源码事实与缺口

当前 Gitea 私有仓库为：

| 仓库 | 已确认内容 |
| --- | --- |
| `gitadmin/model-platform-config` | Argo Application、训练 Helm values、TrainingRequest 平台 API、K12 与 ModelDeployment 的生产 GitOps 期望状态 |
| `gitadmin/kcc` | `app/data_pipeline` 的 K12 数据管线源码；`pretrain-ray-main` 的训练代码、contracts、deploy、docker、tests 与 Ray startup bundle |
| `gitadmin/platform-backstage` | 2026-08-31 创建的私有 Backstage 源码目标仓库；当前仅有初始化 `main`，等待完整当前源树回填 |

`gitadmin/kcc` main 在盘点时为 `ac8f042961037bad19bd8c667a10f6fc79fe578f`，
包含 “K12: complete NPU smoke orchestration” 的合并记录。

**缺口：** 当前运行 Backstage tag 中的短 SHA `ca2b700` 与当前训练 Controller
tag 中的 `895f830` 都不能由 Gitea `gitadmin/kcc` API 解析为 commit；Backstage
镜像也未携带可用的 OCI source/revision label。可回滚镜像和 GitOps 配置存在，但
当前 Backstage/KCC Console 的完整 TypeScript/后端源码快照尚未形成可验证的 Gitea
commit 映射。

这不是允许以另一个干净工作区重建 Backstage 的理由。反而应把它视为 release
provenance 缺口：在源码快照回填前，旧 image digest 是唯一可信的回滚产物。

## 3. 下次 Backstage 更新的硬门禁

下次 Backstage 变更前，发布者必须创建一份 release provenance 记录，至少包含：

```text
source repository + full commit SHA
build-context SHA256
image tag + immutable digest + linux/amd64 proof
enabled module inventory
server-side dry-run scope
post-rollout route/API acceptance
```

不得从只包含某个新页面或某个新 backend module 的 detached clean worktree 构建。
构建上下文必须同时包含并保留：

1. Gitea OIDC、catalog 与基础 Backstage app；
2. K12 data-pipeline frontend/backend、K12 read-only RBAC、Dagster launch/status；
3. KCC training console、TrainingRequest/TrainingRun 只读状态与受限操作入口；
4. Model Recipes、ModelDeployment Start/Stop、推理生命周期/状态聚合；
5. Artifact Keeper management、Tekton publish/status、关联 catalog templates；
6. `app-config*.yaml`、catalog locations、后端 plugin registration、RBAC 和
   NetworkPolicy 的完整配套变更。

构建前必须在源树执行：

```bash
node .yarn/releases/yarn-4.13.0.cjs tsc --noEmit
node .yarn/releases/yarn-4.13.0.cjs workspace app test --runInBand
node .yarn/releases/yarn-4.13.0.cjs workspace backend build
```

发布后至少验证：

```text
/healthcheck
/kcc-pretraining
/model-recipes
/data-pipeline
/api/model-platform/deployments
```

并确认 Backstage ServiceAccount 仍然只读：可读取批准的训练/推理状态，不能读取
Secret、创建 Deployment、直接创建 Ray/NPU workload。

## 4. 源码回填行动

下一次 Backstage 功能更新之前，需要由当前 `0.5.9-kcc-merge-ca2b700` 构建责任人
提供精确源码目录或可验证 commit。完整源树应导入已创建的私有仓库：

```text
http://110.120.0.3:30081/gitadmin/platform-backstage.git
```

随后：

1. 将完整 Backstage/KCC Console 源码提交到 `gitadmin/platform-backstage`；
2. 将 image digest 与 full source commit 写入 release record；
3. 为 Backstage Dockerfile 添加 OCI labels：
   `org.opencontainers.image.source`、`org.opencontainers.image.revision`、
   `org.opencontainers.image.version`；
4. 用该 Git commit 重建一次相同模块集合的候选镜像并进行 route/API parity 验证；
5. 只有 parity 通过后，才将其作为下一次 Backstage 的安全基线。

在该行动完成前，禁止把 Material 中较旧或只含部分模块的 Backstage 源码当作当前
`0.5.9` 的替代品覆盖生产。
