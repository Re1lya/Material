# 模型集成平台当前状态（2026-08-28）

> 本文是“当前生产事实”的权威入口，不是目标架构或实施日志。
> 只有已在 `server-00` 生产 K3s、生产 Gitea 或 Artifact Keeper 中观测到的事项才标记为已完成。
> 密码、Token、Secret data、kubeconfig 和 Docker config 内容不得进入本文。

## 1. 文档边界

Material 中的平台文档分为三类：

| 类型 | 用途 | 主要文档 |
| --- | --- | --- |
| 目标方案 | 定义最终要建成什么、职责边界和验收门禁 | `TARGET-ARCHITECTURE.md`、`backstage/model-deployment-automation-plan-20260825.md`、`data-pipeline/k12-platform-integration-plan-20260827.md` |
| 当前状态 | 记录此刻已上线、未上线、异常和下一步 | **本文**、`HANDOFF-20260827.md` |
| 实施路线 | 记录当前到目标的差距、优先级和责任边界 | `ROADMAP.md` |
| 实施记录 | 保留某次发布、迁移、Smoke、回滚和历史证据 | `progress-20260810.md`、`*-deployment-record-*.md`、`data-pipeline/*-record-*.md` |

目标方案不等于已实施；实施记录也不当然代表当前仍在运行。

## 2. 生产总览

| 模块 | 当前状态 | 结论 |
| --- | --- | --- |
| K3s | 10 个节点 Ready，`server-00` 为唯一 control-plane | 可用，但仍存在单控制面维护窗口风险 |
| Artifact Keeper | backend 1.6.4、Web、PostgreSQL Ready | 可用；`container-images` 已超配额 |
| Gitea | 应用与 PostgreSQL Ready | 生产配置事实源可用 |
| Argo CD | K12/bootstrap/model-deployment 三个 Application Synced/Healthy | 仍为人工 Sync，prune/self-heal 关闭 |
| Tekton | Operator、Pipelines、Triggers、Pruner Ready | K12 专用 CI 正常；通用模型配置 CI 仍失败 |
| Crossplane | Core、Function、provider-kubernetes Ready | 推理平台 API 可用，Qwen38 XR 当前停止并暂停调谐 |
| Backstage | `platform/kcc-backstage:0.1.4-recipe-ui-20260828` 1/1 Ready | K12 CPU 页面保持可用；vLLM 风格模型目录与推理参数配置页已上线 |
| K12 CPU 数据管线 | 新 Dagster 1/1，Ray CPU head/worker Ready | CPU 平台集成已完成 |
| 旧 K12 Dagster | Deployment 0/0，未删除 | 仅作为有界回滚对象 |
| Qwen3.8 推理 | `ModelDeployment` 为 Stopped、paused | 历史 TP2 端到端验证通过，当前无在线 RayService |
| KCC 训练系统 | 由训练侧独立实施，当前正在联调 | Argo 应用 OutOfSync，状态合同与调度仍需收敛 |

## 3. 已完成的 K12 CPU 闭环

当前生产已完成：

1. KCC 源码经专用 Tekton CI 测试、Definitions import 和策略校验。
2. AMD64 CPU 镜像发布到 Artifact Keeper 不可变 digest。
3. `model-platform-config` 通过 K12 专用 GitOps CI，再由 Argo CD 人工同步。
4. 新 Dagster、Ray CPU head/worker、20Gi Retain PVC 与最小 MinIO 身份正常。
5. 旧 Dagster 62 条生产历史迁入新 storage 布局，66 个 SQLite 数据库 `quick_check` 通过。
6. Backstage 使用真实 OIDC 身份启动审核过的 `cleanjopbstage1_10`，10 文档任务成功。
7. 兼容 NodePort `30080` 已纳入 GitOps，指向新 Dagster。

完整证据见 `data-pipeline/k12-cpu-backstage-cutover-record-20260828.md`。

## 4. 已上线但尚未进入 Material 提交

本地 Material 仍停留在 `defff9c`。本次文档更新开始前，工作区已有
26 个已修改文件和 30 个未跟踪路径。以下内容已在生产观测到，
但 Material 中仍未形成可审查提交：

- K12 Tekton Pipeline、Trigger 和独立 GitOps validator。
- K12 Argo AppProject/Application 和发布 overlay。
- K12 Dagster/Ray CPU、PV/PVC、NetworkPolicy 与兼容 Service 源材料。
- Backstage data-pipeline 前后端、RBAC、NetworkPolicy、镜像锁和发布记录。
- Crossplane Qwen Composition 的 A3 head 节点约束与
  `huawei.com/skip-ascend-plugin` 注解。
- XRD 的 `accelerator-type: module-a3-16` 校验。
- release bot、Argo reader 轮换和 K12 MinIO 身份记录。

这些已上线变更应优先整理为按职责拆分的提交，避免生产与 Material 持续分叉。

## 5. 本地已准备但尚未发布的推理变更

本地 `qwen38-27b.yaml` 已改为 `desiredState: Running`、`workerReplicas: 1`、
`crossplane.io/paused: "false"` 并指定 `Ascend910-8,Ascend910-9`。这些变更**尚未 apply**，
也不应直接推送，因为当前校验链仍未自洽：

- ModelDeployment JSON Schema 尚不允许 `crossplane.io/paused`。
- 生产 Gitea 中的 XR、RuntimeProfile 和 schema 存在版本漂移。
- 通用 `validate-model-platform-config` 最近运行持续失败。
- `qwen38-27b-cache` Job 仍因 PodTemplate immutable 无法调谐。

在恢复 Stopped、Synced=True 且通用 CI 绿色前，不应启动该推理请求。

## 6. 正在进行和已知异常

### 6.1 通用 GitOps CI

K12 专用校验已绿色，但通用模型配置校验仍因 Qwen38 schema、停止态和
RuntimeProfile 差异失败。这使得当前 `model-platform-config` 不能作为全局绿色门禁。

### 6.2 推理组合资源

`model-serving/qwen38-27b-cache-job` 持续报同名 Job `spec.template` 不可变。
需将缓存 Job 改为按 ModelVersion/manifest digest 版本化，并设计旧 Job 收敛策略。

### 6.3 训练侧集成

训练侧由独立同事负责，Material 当前不保存其完整源码。实时观测为：

- `model-platform-training-system` Application 为 OutOfSync/Healthy，有 10 个 orphaned resources。
- KCC Controller 正在运行并生成 TrainingRun/RayCluster。
- 存在 Volcano gang 不可调度和 Ray head/worker readiness 告警。
- `TrainingRequest.status.outputArtifact` 与 XRD 正则不匹配，状态回写仍需修复。

本文只记录集成面可观测事实，不代替训练侧自己的发布记录。

### 6.4 容量和主机维护

- Artifact Keeper `container-images` 使用 70,401,864,552 bytes，配额
  53,687,091,200 bytes，已超额约 31%。
- `model-artifacts` 使用 68,599,066,123 bytes / 461,708,984,320 bytes。
- `container-images` 当前允许匿名读取；是否保留该内网策略需明确。
- `server-00` 仍提示需要重启，约 204 个 zombie 进程；根盘约 52%，
  `/mnt/data` 约 78%。
- `gpu-server-07` Ascend 设备告警尚无正式关闭记录。

## 7. 建议下一步

1. 按“K12 发布源码”、“Backstage 集成”、“Tekton/GitOps”、“Crossplane 实时差异”、
   “记录和身份”拆分并提交当前 Material 工作区。
2. 更新生产 Gitea 的 ModelDeployment schema/catalog/XR，恢复通用 CI 绿色。
3. 修复模型缓存 Job 版本化，将 Qwen38 恢复到干净 Stopped 基线。
4. 由训练侧收敛 Argo OutOfSync、orphan、outputArtifact schema 和调度/探针问题。
5. 扩容或安全清理 `container-images`，再发布新镜像。
6. 安排 `server-00` 维护窗口。
7. K12 稳定观察后，决定是否删除零副本旧 Deployment。

## 8. 当前证据入口

- K12 CPU 发布：`data-pipeline/k12-cpu-control-plane-release-record-20260827.md`
- K12 CPU Smoke：`data-pipeline/k12-cpu-compatibility-smoke-record-20260828.md`
- Dagster 状态迁移：`data-pipeline/k12-dagster-state-storage-migration-20260828.md`
- Backstage 与服务切换：`data-pipeline/k12-cpu-backstage-cutover-record-20260828.md`
- 自动化身份：`identity-operations-20260825.md`
- Qwen Ray 历史验收：`qwen38-ray-tp2-execution-20260819.md`
- 历史总记录：`progress-20260810.md`
