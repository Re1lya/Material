# 模型集成平台当前状态（2026-09-05）

> 本文是截至 2026-09-04 的最新已验证快照。它区分已上线生产事实、已完成的
> 受控 smoke，以及尚未发布的本地候选；不把源码、镜像或 dry-run 写成生产部署。
> 2026-09-05 未重新执行全量生产盘点，因此本文不对 2026-09-04 之后的实时状态作
> 推断。密码、Token、Secret data、kubeconfig 和 Docker config 内容不得进入本文。

## 1. 当前结论

| 领域 | 最新已验证状态 | 结论 |
| --- | --- | --- |
| Dashboard 健康/时间线 | 2026-09-03 已发布 `kcc-backstage:0.6.1-model-health-2a64524@sha256:b3fbe8c105a4c109ad916d4736f16cae7938d0d58474d5add1e9c036cda356a3`（linux/amd64）；1 个 Pod Ready、零重启 | 已上线。状态 API 可返回时间线和健康字段，但实际模型探针的端口缺陷在下一次 v2 smoke 中暴露，不能仅凭该页面宣称推理 Healthy。 |
| v2 Qwen 部署合同 | `modeldeployment-stopped-v2` 与 `modeldeployment-qwen38-ray-v2` 已安装；`qwen38-27b` 已迁移到 v2 停止态 | 控制面 v2 已上线并保留 v1 回滚基线。 |
| v2 端到端 smoke | 2026-09-04 的受控 Start 已经由 Argo/Crossplane/KubeRay 完成；TP=2 worker 在 `a3-server-00` 使用 Ascend910-10、11，真实对话已由用户在运行时验证 | 运行链路和模型可用性已通过一次受控验证；该 smoke 已停止并清理。 |
| 当前推理资源 | smoke Stop 已通过 main-push Tekton 和 Argo 同步；XR 回到 v2 Stopped、Synced/Ready=True、零请求 NPU；RayService、RayCluster、head/worker、PVC 与 Job 均已移除 | 已知的最后安全终态是 Stopped、零 NPU；Running Window=false。 |
| 直接操作/API 与动态调参 | 直接操作候选已合并，包含版本化 Backstage PostgreSQL 配置/操作记录、固定实例的乐观并发 patch、独立容量检查和特性开关 | **未发布、未启用**。没有 Argo 所有权迁移、数据库迁移、RBAC apply、ModelDeployment patch 或 NPU workload。 |
| 传统 GitOps 操作 | 既有 Gitea/Tekton/Argo Start/Stop 仍是现行路径和回滚路径 | 直接 API 处于 shadow/迁移准备阶段，尚不能替代 GitOps。 |

## 2. 已上线的 Dashboard 与 v2 smoke 证据

健康/时间线版本在生产中完成了以下受限变更：Backstage 可读取 EndpointSlice，
新增仅限 TCP/8000 的 NetworkPolicy；ServiceAccount 没有 EndpointSlice 写权限。
在没有创建 ModelDeployment、Composition、NPU workload 或打开 Running Window 的前提下，
`/api/model-platform/deployments` 返回 HTTP 200，两个已知部署保持 Stopped。

2026-09-04 随后的 v2 smoke 证明了运行路径：Argo 同步 v2 Running 请求，
Crossplane 选择 `modeldeployment-qwen38-ray-v2`，Ray head 与一个 TP=2 worker Ready。
缓存 Job 在 31 秒内完成，运行镜像已存在；控制面交接为秒级、Pod Ready 约 25 秒，
主要剩余耗时为 Ray Serve/vLLM 模型加载。完整记录见
`model-deployment-v2-smoke-20260904.md`。

该 smoke 的 Stop 在关闭 Running Window 后执行。一个无 ownerReference 的 Completed
cache Pod 曾阻塞 PVC 终止，已只删除该精确的完成 Pod；Retain PV 和缓存数据保持
Released，以便下次经过验证的重新绑定。该问题不等同于删除缓存数据或 PV。

## 3. 已知缺口与动态参数版本状态

v2 smoke 发现当前已发布 Dashboard 的两个运行态问题：探针 URL 未从名为 `serve`
的端口推导 `:8000`，导致真实推理可用时页面仍显示 `Serving pending`；且当
`desiredState=Running` 但健康探针失败时，页面不允许 Stop。PR/Argo 交接期间还可能
短暂显示 Stopped 并重新启用 Start。它们均未改变 smoke 的实际推理结果，但阻止将
Dashboard 状态当作最终健康或操作幂等的依据。

2026-09-04 的直接操作候选修复/覆盖的范围包括显式 `serve:8000` 探测、运行中任意
非 Stop 阶段允许 Stop、版本化配置和操作历史、固定为
`model-serving/qwen38-27b` 的 resourceVersion 并发检查，以及独立容量检查。候选
镜像为
`kcc-backstage:0.6.12-direct-operations-b73365e-r1@sha256:f2c1c17f3cff391012c46ce20d1aa9f4f838ac48ae9a6cba348022b9880b8954`
（linux/amd64）。它已完成目标测试、构建和服务端 dry-run，但
`modelPlatform.directOperations.enabled=false`。

因此，用户可修改的推理参数、配置版本和审计的实现已经进入候选阶段，**尚未成为
生产可用的在线 Update 功能**。不得在 feature flag 关闭、实例仍由 Argo 管理的状态下
把数据库候选或直接 API 当作运行态写入口。

启用前仍需依次完成：

1. 在 Stopped/零 NPU 基线中从 Argo 的实例源路径移除 `qwen38-27b`，并对仅移除
   Argo tracking metadata 的精确 live XR patch 做服务器端 dry-run；prune/self-heal
   必须继续关闭。
2. 发布候选 Backstage 与其最小 RBAC/NetworkPolicy，运行一次人工创建的、挂起的
   cache-reaper shadow Job，并检查其日志和选择范围。
3. 在经批准的 Running Window 做 capacity-checker shadow 验证；它必须获得 A3 设备
   0–15 每张卡一条新鲜、格式正确的进程指标，任何占用、缺失、重复、错误或过期指标
   都必须拒绝 Start。
4. 仅在上述证据和明确批准后，执行一次可审计的 feature-flag 配置发布；GitOps
   Start/Stop 继续保留为回滚路径。

## 4. 文档与发布边界

- `backstage/model-deployment-health-timeline-release-20260903.md`：已发布 Dashboard
  健康/时间线版本的生产证据。
- `model-deployment-v2-smoke-20260904.md`：一次 v2 Start、真实推理与 Stop/清理证据。
- `backstage/model-deployment-direct-operations-candidate-20260904.md`：直接操作候选的
  provenance、测试、dry-run 与未发布边界。
- `backstage/model-deployment-direct-operations-migration-20260904.md`：切换实例所有权
  和启用 feature flag 的唯一受控迁移顺序。

K12、训练侧、Gateway、Artifact Keeper 容量和 `server-00` 维护事项没有在本轮证据中
重新盘点；继续以相应的发布记录和责任团队结论为准。
