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
| Argo CD | K12、bootstrap、ModelDeployment Application 为 Synced/Healthy；training Application 为 OutOfSync/Healthy | `model-platform-deployment-requests` 已开启受限 automated sync（prune/self-heal/allowEmpty=false）；training 仍有 orphaned resources 待审查 |
| Tekton | Operator、Pipelines、Triggers、Pruner Ready | 通用模型配置 CI、Running capacity gate 和自动合并已通过生产验收 |
| Crossplane | Core、Function、provider-kubernetes Ready | Qwen38 XR 已收敛为 Stopped、Synced=True、Ready=True，版本化缓存 Job 已完成 |
| Backstage | `kcc-backstage:0.6.1.2-serving-contract-hotfix-20260901` 1/1 Ready；训练、推理、K12 路由均 HTTP 200 | Start/Stop 支持 stopped ↔ Ray Composition，并保留结构化 serving 合同；Dashboard 候选未部署 |
| K12 CPU 数据管线 | Dagster 1/1、Ray CPU head/worker Ready；遗留 MinerU NPU smoke 已取消并缩到 0 | CPU 平台集成可用；Application 已恢复 Synced/Healthy |
| 旧 K12 Dagster | Deployment 0/0，未删除 | 仅作为有界回滚对象 |
| Qwen3.8 推理 | 零资源 Stop、Retain PV自动重绑、结构化 serving和 worker readiness回归均已修复；当前 Stopped/Synced/Ready且无运行资源 | Running Window仍为用户批准的开启状态；下一次 Start将使用修复后的完整链路 |
| KCC 训练系统 | TrainingRequest XRD/Composition、KCC Controller 2/2、多个 TrainingRequest 已在生产 | Application `OutOfSync/Healthy` 且有 orphaned resources；TrainingRun outputArtifact 与完整源码 provenance 仍需收敛 |

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

## 5. 推理发布当前边界

Running 阶段前置开发已上线并通过真实生产验证：Running 机器门禁
（capacity gate + running merge）、Backstage Start-inference action
（0.1.6.1）与 scoped auto-sync 的开/关（含 Stop 回退）均在受控窗口内
打通（`tekton/running-gate-and-first-controlled-start-20260828.md`）。
2026-08-31 已在不修改全局 Volcano/KubeRay 调度参数的条件下完成正式
Running 验收：动态容量 gate、自动合并、Argo 自动同步、Crossplane、Volcano
PodGroup、两卡 Worker、Ray Serve/vLLM 模型加载和 `/v1/chat/completions` HTTP 200
全部通过，实际卡为 Ascend910-14/15。验收后 Git Stop 和 Argo 自动回退成功，当前
qwen38-27b 与 qwen38-stopped-auto-smoke 均为 Stopped 基线、零 NPU。
遗留缺口是 KubeRay v1.6.0 不会让已存在的 pending RayCluster 随 RayService 的
workerReplicas 0/1 原地更新，启动和停止仍各需一次受控 RayCluster 删除重建；该动作
需要进入平台自动化后才能宣称完全无人值守。
`prune`/`selfHeal`/`allowEmpty` 保持 false。

## 6. 正在进行和已知异常

### 6.1 通用 GitOps CI

K12 专用校验保持绿色。ModelDeployment schema、RuntimeProfile 和 Stopped XR 已通过
Gitea PR #10 收敛；精确 PR head `0bf417b8…` 和合并后 main `16d36213…`
均通过 Tekton 校验。经批准的手工 Sync 已完成，推理 Application 当前为
Synced/Healthy；automated sync、prune 和 self-heal 仍未启用。

通用 CI 的 Stopped auto-merge Task 首次生产 Smoke（PR #11、PipelineRun
`b6pg4`）因 emptyDir workspace 不跨 Task Pod 共享而失败，未产生任何合并或
同步副作用；修复（读取 Gitea Contents API）已随 Pipeline generation 11
发布，PR #11 经 close/reopen 重触发后校验、自动合并、commit status 与
合并后 main PipelineRun（`2zqdm`、`67k8q`）全部成功，详见
`tekton/model-deployment-auto-merge-20260828.md`。当前 Gitea main 为
`0021e86439d43ef93b0f79587dfaeb8b57b51a44`。scoped automated sync 开启后
推理 Application 已恢复 Synced/Healthy，`qwen38-stopped-auto-smoke` XR 为
Stopped/Synced=True/Ready=True 且零 NPU，详见
`gitops/argo-auto-sync-and-stopped-acceptance-20260828.md`。

### 6.2 推理组合资源

基于 `spec.cache.revision` 的版本化合同已上线。
`qwen38-27b-cache-f2afa9e2-r1` 成功复用并校验现有缓存，Job 1/1 Complete；
XR 为 Stopped、Synced=True、Ready=True 且已解除 pause。当前停止态会保留一个
CPU-only Ray head，worker=0、NPU请求=0。详情见
`crossplane/cache-job-versioning-20260828.md`。

### 6.3 训练侧集成

训练侧已通过 `TrainingRequest` XRD、`trainingrequest-kcc-v1alpha1`
Composition、KCC Controller 与 Argo 多 source Application 进入生产。Controller 2/2
Ready，TrainingRequest 均 Synced/Ready，历史 TrainingRun 包含 Succeeded、
ManualRequired 与 Suspended；当前没有训练 NPU workload。

`model-platform-training-system` 当前是 OutOfSync/Healthy，并报告 orphaned
resources，不能未审查即全量 Sync。训练 GitOps 配置在
`gitadmin/model-platform-config`，训练/K12 源码在 `gitadmin/kcc`；当前 Backstage
和 Controller image tag 的 source SHA 映射仍需回填。完整保留规则见
`TRAINING-BACKSTAGE-PROVENANCE-20260831.md`。

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
