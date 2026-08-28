# 模型集成平台目标架构 v2

> 文档类型：目标态。
>
> 本文定义平台最终要收敛到的稳定架构、责任边界和验收合同。
> 它不记录当前生产版本、节点空闲情况、具体卡号或某次模型发布参数。
> 当前事实见 `CURRENT-STATE-20260828.md`，实施顺序见 `ROADMAP.md`。

## 1. 目标

平台为使用者提供受控的模型目录、推理部署申请、审批、发布、状态、
停止和回滚能力。使用者不需要编写 Kubernetes YAML、选择物理卡号、
处理制品 Token 或直接访问集群。

平台的最终闭环为：

```text
Backstage request and approval
  -> Gitea desired state and audit history
  -> Tekton validation and policy gate
  -> constrained merge
  -> scoped Argo CD synchronization
  -> Crossplane ModelDeployment composition
  -> versioned model cache preparation
  -> KubeRay RayService
  -> stable inference Service contract
  -> runtime health and status back to Backstage
```

## 2. 范围与外部边界

### 2.1 本平台负责

- 模型和运行时目录。
- 推理部署申请、审批、审计和幂等请求管理。
- GitOps 变更生成、策略校验、合并与受控同步。
- 高层 `ModelDeployment` 到缓存、RayService、Service 和策略对象的组合。
- 推理实例的启动、停止、回滚、健康状态和失败原因聚合。
- 容器镜像、模型制品和运行配方的不可变引用。

### 2.2 训练侧边界

训练运行时和训练 Controller 由训练团队负责。集成平台只约定：

- `TrainingRequest` / `TrainingRun` 的稳定 API 和状态语义。
- Backstage 中的受权申请、审批和只读状态入口。
- Gitea、Argo CD、Crossplane 和训练 Controller 之间的事实源与所有权。
- 制品、数据、checkpoint 和 output 的坐标合同。

本平台不实现训练脚本、RayJob 编排、checkpoint 算法或训练故障恢复逻辑。

### 2.3 Gateway 边界

Gateway、TLS、入口认证和流量治理由后续网关集成负责。推理平台输出：

- 稳定的 Kubernetes Service 名称和端口。
- 稳定的健康、就绪和推理 API 路径合同。
- 可供 Gateway/HTTPRoute 引用的 namespace 和服务标签。
- 发布 revision、当前模型和健康状态。

推理平台不在当前范围内创建公网入口或实现网关认证。

## 3. 稳定事实源

| 数据 | 权威来源 | 说明 |
| --- | --- | --- |
| 业务源码 | 对应 Gitea 源码仓库 | 精确 commit、受保护分支和 Release |
| 平台配置期望状态 | `gitadmin/model-platform-config` | 所有非敏感生产声明的唯一 Git 事实源 |
| 模型文件与 manifest | Artifact Keeper `model-artifacts` | 不可变 revision 和 checksum |
| 平台容器镜像 | Artifact Keeper `container-images` | 按 digest 引用，不使用浮动 tag 部署 |
| 实际运行状态 | Kubernetes API | XR、RayService、Pod、Service、Job 和 Event |
| 用户入口与聚合状态 | Backstage | 不是底层状态唯一来源 |
| 凭据 | root-only 受控文件或 namespace-local Secret | 不进入 Git、构建上下文或前端 |

## 4. 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| Backstage | 目录、受控表单、审批、审计、状态和回滚入口 | 直接创建 Pod、持有集群管理凭据、中转模型大文件 |
| Gitea | 源码、配置期望状态、PR、审批和 Release 历史 | 运行 Pipeline 或管理 Pod |
| Tekton | 源码测试、schema/策略、digest/架构、制品可读性和审批门禁 | 直接调用 Argo CD、长期管理业务资源 |
| Merge Bot | 仅合并已通过策略和有效审批的生成分支 | 读取 Kubernetes Secret、写其他仓库、调用集群 API |
| Argo CD | 将已合并的期望状态同步到限定 namespace | 解释模型格式、负责容量审批、保存制品 |
| Crossplane | 维护长期平台 API，将 ModelDeployment 组合为受限资源 | 执行 CI、管理训练任务、代替 KubeRay |
| Model cache | 按 manifest digest 下载、校验、原子发布和复用节点工作副本 | 覆盖正式制品、作为模型权威仓库 |
| KubeRay | RayService/RayCluster 生命周期、Serve 应用和派生 Service | 读 Git、处理审批、上传模型 |
| Artifact Keeper | 镜像、模型制品、checksum、权限和审计 | 创建推理 Pod、选择运行资源 |

## 5. 稳定平台对象

### 5.1 ModelVersion

描述不可变的模型版本，至少包含：

- 原始 model ID 和精确 revision。
- Artifact Keeper repository/path。
- canonical manifest digest。
- 格式、量化类型、大小和文件清单。
- 支持的 RuntimeProfile 集合。
- 发布、撤销和兼容状态。

### 5.2 ModelRuntimeProfile

定义经认证的运行契约，而不是单次部署请求：

- 镜像 digest 和目标架构。
- 模型格式/量化兼容性。
- Ray、vLLM/厂商栈版本合同。
- CPU、内存、NPU、TP/PP/DP 和节点池上限。
- 服务路径、健康检查和最小验收请求。
- 启动、停止和回滚策略。

具体节点、卡号和某次容量结论不进入通用目标架构；它们属于受审
RuntimeProfile、运行窗口或发布记录。

### 5.3 DeploymentRequest and Approval

请求和审批必须持久化并关联：

- request ID、申请人、项目和时间。
- ModelVersion、RuntimeProfile、资源参数和目标状态。
- 审批人、角色、有效期、撤销状态和审批事实摘要。
- Gitea PR/commit、Tekton PipelineRun、Argo revision 和 XR 的追踪关系。

浏览器内的二次确认不等于可审计审批。

### 5.4 ModelDeployment

`ModelDeployment` 是长期推理部署的高层声明，包含：

- ModelVersion 和 RuntimeProfile 引用。
- `Stopped` / `Running` 期望状态。
- 受控节点池和有界资源参数。
- 缓存契约、服务合同、发布 revision 和回滚信息。

Crossplane Composition 为它生成 PVC/缓存准备对象、RayService、稳定 Service、
NetworkPolicy 和状态对象。

## 6. 推理状态机

```text
Draft
  -> Validating
  -> AwaitingApproval
  -> Approved
  -> Merging
  -> Syncing
  -> PreparingCache
  -> Deploying
  -> Running
  -> Stopping
  -> Stopped
```

任何阶段可进入 `Failed`，但必须保留原始阶段、原因、request ID、commit、
PipelineRun 和相关 Kubernetes 对象。

状态规则：

- `Stopped` 不创建可运行的 NPU worker。
- 缓存未验证 `READY` 时不得进入 `Deploying`。
- 审批过期、制品不匹配或容量不足时不得进入 `Running`。
- Stop 和紧急停止的优先级高于新的 Start。
- 回滚通过恢复已验证 Git revision 或前一个运行时/模型引用完成，不现场修补 Pod。

## 7. GitOps 和自动化等级

### 7.1 基础阶段

- PR 与 Tekton 校验自动。
- 合并与 Argo CD Sync 人工。
- prune/self-heal 关闭。

### 7.2 停止态自动化

- 只允许自动合并和同步 `Stopped` 请求。
- Composition 必须证明不产生 NPU Pod。
- 自动化仅限独立 Application 和 namespace。

### 7.3 受控运行态自动化

- 需要有效审批、RuntimeProfile allow-list、制品可读性、容量和运行窗口检查。
- Argo CD 只对推理请求 Application 启用 scoped automated sync。
- prune 和 self-heal 默认仍关闭。
- 保留 Sync Window、紧急停止和回退到人工 Sync 的开关。

## 8. Crossplane 组合约束

- 生产 XR 使用 `compositionUpdatePolicy: Manual` 并固定已验证 CompositionRevision。
- Composition 不得通过 patch 已存在 Job 的 PodTemplate 实现缓存更新。
- 缓存任务名称包含 ModelVersion 或 manifest digest 的稳定版本标识。
- 新缓存验证成功前保留当前可回滚缓存。
- Composition 必须产生可聚合的 conditions，不仅是底层 Object `Synced=True`。
- Crossplane 不管理训练任务的细粒度运行流程。

## 9. 制品和缓存

模型发布必须遵循：

```text
candidate upload
  -> file and manifest validation
  -> immutable Artifact Keeper revision
  -> ModelVersion registration
  -> runtime compatibility validation
  -> versioned node cache
  -> inference deployment
```

- Git、Argo CD 和 Crossplane 只传递制品坐标和 digest。
- 模型文件不进入 Git、Helm Chart 或推理运行时镜像。
- 缓存使用临时目录、checksum、原子切换和 `READY` 标志。
- 缓存删除与 ModelDeployment 删除分离，避免回滚材料被误清理。

## 10. 权限和供应链

- 一个工作流一个机器身份，不共享管理员 Token。
- Backstage 不具有集群级写权限。
- Tekton 测试与发布身份分离，不使用 Docker socket 或无边界 privileged Pod。
- Argo CD 只读取批准仓库和路径。
- Crossplane Provider 只操作已批准 namespace 和资源类型。
- 生产镜像固定 digest，后续增加 SBOM、漏洞扫描和签名验证门禁。
- 凭据值只存在受控文件或 Kubernetes Secret，文档只记录身份、权限和引用路径。

## 11. 状态、可观测和审计

Backstage 必须能够通过 request ID 聚合：

- Gitea PR、commit 和审批状态。
- Tekton PipelineRun 及失败步骤。
- Argo CD revision、Sync 和 Health。
- Crossplane XR conditions 和组合资源。
- 缓存进度、RayService/RayCluster/Pod 状态。
- 模型加载、推理健康、延迟、吞吐和 NPU 指标。
- 失败原因、建议操作和可回滚 revision。

审计中不记录完整 Token、密码、模型文件内容或用户提示词。

## 12. 可用性和运维目标

近期目标：

- 容量配额、备份、恢复演练和主机维护窗口。
- 关键控制面组件的资源上限、告警和发布回滚。
- Artifact Keeper、Gitea、Backstage 和状态存储的可恢复备份。
- 对现有单 control-plane 和 local PV 故障域做出明确运维承诺。

长期目标：

- 评审控制面高可用、异机备份和共享/对象存储。
- 在不改变 ModelVersion/ModelDeployment 合同的前提下替换底层存储和运行时。

## 13. 非目标

- 不在本平台重新实现 KubeRay、Argo CD、Tekton 或训练 Controller。
- 不使用 Backstage 或 Tekton 中转模型大文件。
- 不允许用户输入任意镜像、节点、物理卡号、HostPath 或 Kubernetes YAML。
- 不将单次 Qwen 验证参数提升为全平台固定规则。
- 不在网关团队集成前自行实现对外入口、TLS 或统一流量管理。
- 不在推理发布流程中修改训练侧资源或实现。

## 14. 目标验收标准

平台目标态至少满足：

1. 用户只能从已验证的 ModelVersion 和 RuntimeProfile 发起请求。
2. 所有请求、审批、合并、同步和运行对象共享同一 request ID。
3. 停止态全自动不产生 NPU Pod。
4. 运行态只在审批、制品、容量和运行窗口门禁通过后启动。
5. 缓存可版本化、可恢复、可复用，不再因同名 Job immutable 失败。
6. 生产 XR 固定已验证 CompositionRevision。
7. 用户可从 Backstage 看到真实阶段、失败原因、健康和可回滚版本。
8. Stop 和回滚不依赖现场修改 Pod。
9. 训练与 Gateway 集成只通过明确 API/服务合同发生，不共享管理权限。
10. 非敏感生产声明、镜像 digest、配置和发布证据可从 Git 重建。
