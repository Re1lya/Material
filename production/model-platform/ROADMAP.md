# 模型集成平台实施路线图

> 文档类型：当前状态到目标架构的实施桥梁。
>
> 目标架构见 `TARGET-ARCHITECTURE.md`，当前生产快照见
> `CURRENT-STATE-20260828.md`。本文的状态会随实施变化，不保留每次发布的完整证据。

## 1. 状态定义

| 状态 | 含义 |
| --- | --- |
| Complete | 已在生产实施并有验收证据 |
| In progress | 已有生产或工作区实现，但门禁未全部通过 |
| Prepared | 已有设计/源码/清单，尚未进入受控发布 |
| Blocked | 存在必须先解决的外部或技术条件 |
| External | 由其他责任团队实施，平台只跟踪集成合同 |

## 2. 当前里程碑

| 工作包 | 状态 | 当前结果 | 完成门禁 | 责任边界 |
| --- | --- | --- | --- | --- |
| 生产控制面 | Complete | Artifact Keeper、Gitea、Argo CD、Tekton、Crossplane、Backstage、KubeRay Ready | 持续健康、版本/镜像可追溯 | 平台 |
| K12 CPU 平台集成 | Complete | CI、GitOps、Dagster/Ray CPU、状态迁移、Backstage 启动和 NodePort 切换通过 | Material 提交归档；观察后决定旧 Deployment 删除 | 平台/K12 |
| Material 事实归档 | In progress | 大量已上线源码、清单和记录仍未提交 | 按职责拆分审查，可从 Git 重建非敏感生产声明 | 平台 |
| 通用 ModelDeployment CI | Complete | Gitea PR #10 精确 head 和合并后 main `16d36213…` 均通过 Tekton，schema/catalog/Stopped XR 已收敛 | 后续每个请求继续维持 webhook 绿色 | 推理平台 |
| Qwen38 停止态基线 | Complete | Argo Synced/Healthy；XR 为 Stopped、Synced=True、Ready=True、未 paused；RayCluster 只有 CPU head，worker=0、NPU=0 | 后续 Stopped 变更继续保持零 NPU 和可回滚 | 推理平台 |
| 缓存 Job 版本化 | Complete | `qwen38-27b-cache-f2afa9e2-r1` 在生产 30 秒内 Complete，复用现有 READY 缓存，旧 immutable 告警未再出现 | 后续模板/制品变更必须提升 cache.revision | 推理平台 |
| 停止态全自动 | In progress | Backstage PR、Tekton、release bot 和 Argo Application 已具备基础；受限 Stopped auto-merge Task 已实现并通过生产 API server dry-run，尚未发布 | 自动合并/同步只产生 Stopped XR，零 NPU，可一键关闭 | 推理平台 |
| 推理 Running 受控自动 | Prepared | TP2 历史端到端验证通过；本地 Running 请求未发布 | 有效审批、容量/制品门禁、缓存 READY、健康回写和回滚 | 推理平台 |
| Backstage 推理状态聚合 | In progress | 已有目录和请求入口，运行阶段/失败原因尚未完整 | request ID 贯通 Git/Tekton/Argo/XR/RayService/health | 推理平台 |
| 训练集成 | External | 训练 Controller 正联调，Argo OutOfSync，状态 schema/调度/探针有问题 | 训练团队提供稳定 TrainingRequest/TrainingRun 合同和状态 | 训练团队 |
| Gateway 集成 | External | 推理平台尚无对外 Gateway 资源 | 平台输出稳定 Service/健康合同，网关团队完成路由/TLS/认证 | Gateway 团队 |
| Artifact Keeper 容量 | Blocked | `container-images` 使用超配额约 31% | 扩容或安全清理后保留当前和上一可回滚版本 | 平台/运维 |
| `server-00` 维护 | Blocked | 主机待重启、更新和 zombie 进程治理 | 受控窗口内备份、重启、全控制面验收 | 运维 |

## 3. 优先级 P0：恢复事实源和绿色门禁

### P0.1 Material 归档

1. 分离已上线变更与本地未发布的 Running 请求。
2. 分别整理 K12、Backstage、Tekton/GitOps、Crossplane 和文档/身份提交。
3. 移除生成的 `__pycache__` 等非源码文件。
4. 使 Material 能够解释当前生产的非敏感对象和发布 digest。

### P0.2 通用 CI 收敛

1. 对比生产 Gitea main、本地 Material 和实际 XR。
2. 一次性修正 ModelDeployment schema、RuntimeProfile 和 Stopped XR。
3. 清除对 `crossplane.io/paused` 的临时依赖，或在审查后将其纳入明确合同。
4. 要求 webhook 和手工 PipelineRun 均成功。

## 4. 优先级 P1：干净的推理停止态

1. 设计缓存 Job 版本命名，禁止 patch 已存在 Job PodTemplate。
2. 使 Stopped Composition 不生成可运行的 RayService worker。
3. 将 XR 固定到已验证 CompositionRevision，保持 Manual update policy。
4. 验证 PVC、缓存、Service、NetworkPolicy 和状态对象的 owner/删除边界。
5. 达到 XR `Synced=True`、通用 CI 绿色和无循环 Warning。

## 5. 优先级 P2：停止态全自动

1. Backstage 生成有界 Stopped 请求和幂等 request ID。
2. Tekton 校验制品、参数、路径、重复请求和审批语义。
3. Merge Bot 仅合并允许路径和通过门禁的生成分支。
4. 仅为 model-serving 请求 Application 启用可关闭的 scoped auto-sync。
5. 验证 prune/self-heal 关闭、零 NPU、状态回写和一键关闭自动化。

## 6. 优先级 P3：受控推理 Running

1. 实现持久化审批、角色、过期和撤销。
2. 实现 RuntimeProfile、镜像/model digest、缓存 READY 和容量门禁。
3. 使用已验证的 RayService 运行时和最小资源 Profile。
4. 等待 RayService、Serve 应用和最小推理请求成功后标记 Running。
5. 将失败阶段和原因回写 Backstage。
6. 验证 Stop、重启和回滚到前一个已验证 revision。

## 7. 优先级 P4：生产加固

- Artifact Keeper 容量、备份、恢复演练和匿名读策略。
- server-00 维护窗口、控制面故障域和 local PV 恢复手册。
- 镜像 SBOM、扫描、签名与入场验证。
- request ID 端到端日志、告警、SLO 和审计保留。
- 自动化身份轮换、未使用凭据撤销和最小权限复核。

## 8. 外部集成门禁

### 8.1 训练侧

接入 Backstage/统一状态前，训练侧需要提供：

- 受版本管理的 TrainingRequest/TrainingRun schema。
- 无 Argo orphan 的声明式发布。
- 稳定的 status phase/conditions/outputArtifact 合同。
- Stop、回滚、重试和所有权边界。
- Ray/Volcano 调度和 readiness 验收。

### 8.2 Gateway

网关集成前，推理平台需要提供：

- 稳定 Service DNS、端口和 selector。
- 健康、就绪和推理路径。
- 请求超时、最大请求体和连接行为合同。
- 当前发布 revision 和可观测标签。

Gateway 团队负责 GatewayClass/Gateway/Route、TLS、认证、限流和对外 DNS。

## 9. 路线图更新规则

- 只有生产验收通过才将工作包改为 Complete。
- 某次发布的命令、digest、时间和详细故障进入 deployment/record 文档，不堆入本文。
- 当前数值、Pod 名和实时容量进入 `CURRENT-STATE-*`，不进入目标架构。
- 外部团队的实现不复制进 Material；Material 仅保存集成合同和观测结论。
