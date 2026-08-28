# Model Deployment 全自动化目标与分阶段计划

> 文档类型：推理部署自动化组件方案。
>
> 本文保留分级自动化、审批、Merge Bot 和 scoped Argo sync 的设计细节，
> 必须与 `../TARGET-ARCHITECTURE.md` 和 `../ROADMAP.md` 一起使用。
> 当前生产仍为停止态请求、人工合并和手工 Argo CD Sync；实时事实见
> `../CURRENT-STATE-20260828.md`。

## 目标

让用户在 Backstage 选择已验证模型与 RuntimeProfile、进行二次确认后，由系统完成
策略校验、GitOps 变更、CI、合并、部署、健康检查和状态回写。用户不需要进入 Gitea
或 Argo CD 手工操作。

    Backstage request + second approval
      -> Gitea desired-state change
      -> Tekton validation and policy gate
      -> constrained merge bot
      -> Argo CD auto-sync (scoped application)
      -> Crossplane / KubeRay
      -> runtime health + status back to Backstage

Backstage 始终是请求与审批面，不直接拥有 Kubernetes 写入权限；Gitea 是所需状态的
审计记录，Artifact Keeper 保存不可变制品，Tekton 负责校验，Argo CD/Crossplane
执行受控的状态收敛。

## 为什么不能只依赖账户权限

账户权限决定“谁可提交/批准”，但不能独立防止错误制品、未经认证的运行配方、重复
请求、过期审批、资源冲突、CI 失败后的误部署或失陷凭据的扩大影响。因此自动化仍需：

- 后端按身份和角色重新校验每个请求，不能信任浏览器提交的镜像、节点、路径或 YAML；
- Artifact Keeper manifest/digest、ModelVersion 与 RuntimeProfile allow-list 校验；
- Tekton schema、兼容性、容量、重复请求和停止态/运行态策略检查；
- 只限路径与目标仓库的合并机器人；
- 将 Argo CD 自动同步限制到指定 Application，并保持 prune 和 selfHeal 均为 false；
- 可撤销审批、过期时间、幂等 request ID 与完整审计记录。

## 权限模型

| 角色 | 可执行动作 | 不可执行动作 |
| --- | --- | --- |
| Developer | 浏览制品/状态；创建停止态请求 | 启动 NPU、修改 RuntimeProfile、合并 PR |
| Deployer / Project Approver | 在 Backstage 二次批准本项目的启动请求 | 修改制品 digest、节点池或平台配额 |
| Platform Admin | 维护 RuntimeProfile、配额、自动化策略 | 绕过审计或直接由 Backstage 创建 Pod |
| Merge Bot | 仅合并已通过 Tekton、有效审批、允许路径的请求 | 读取 Secret、修改其他仓库、调用 Kubernetes |
| Argo CD | 仅同步已批准的 model-serving Application | prune 资源或自行修复任意漂移 |

第二次确认必须由 Backstage 后端记录：审批人、角色、request ID、模型版本、运行配方、
TP/PP/副本、目标状态、审批时间和过期时间。它不是一个仅在浏览器内完成的确认弹窗。

## 自动化分级

### A. 停止态全自动（先启用）

Developer 提交后，Tekton 校验通过即可由机器人合并；Argo CD 自动同步对应 Application。
Crossplane 只生成 desiredState=Stopped、replicas=0 的对象，不创建 NPU Pod。
这是验证 Backstage → Gitea → Tekton → Argo → Crossplane 自动化的安全第一步。

### B. CPU-only 全自动

在停止态链路稳定后，为明确标记的 CPU RuntimeProfile 启用自动运行。Tekton 检查
namespace quota、网络策略、制品 digest 与健康检查契约；失败时写回 Backstage 状态，
不自动扩展到其他节点或资源池。

### C. NPU 受控全自动（最终目标）

Developer 创建请求后，具备 Deployer/Approver 角色的用户在 Backstage 二次批准；批准仍
只能针对请求中固定的模型版本、RuntimeProfile、TP/PP 和副本数。Tekton 需在合并前
检查设备池策略、NPU 容量、现有保留、运行窗口、配额和制品可读性。全部通过后机器人
自动合并，Argo CD 自动同步，Crossplane/KubeRay 负责创建工作负载。

运行态审批过期、容量不足、请求重复、镜像 digest 不匹配或健康检查失败时，系统不得
创建或继续运行资源；结果必须回写 Backstage。停止操作仍优先于启动操作。

## 实现工作包

1. **Backstage catalog UI**：模型目录页从只读 API 获取 ModelVersion/Artifact Keeper
   摘要；仅展示拥有匹配 RuntimeProfile 的“可部署”模型。
2. **Deployment request UI**：模型详情页选择 allow-listed RuntimeProfile 和有界参数；
   默认停止态，页面不接收任意 image/node/path/YAML。
3. **Approval API 与审计**：后端持久化 request/approval 状态，基于 OIDC 身份和角色
   授权，产生一次性、可过期的审批凭据。
4. **Tekton policy gate**：校验制品、签名/摘要、模型与 profile 兼容性、参数上限、
   去重、审批有效性和容量；将每一步状态回写到 Backstage/Gitea。
5. **Constrained merge bot**：仅能合并通过 gate 的生成分支，限制 repository、路径、
   分支前缀与变更类型。
6. **Argo scoped automation**：只为 model-serving Application 启用自动 Sync；
   保持 prune 和 selfHeal 为 false，并保留暂停、Sync Window 与管理员紧急停止。
7. **运行状态回写**：把 Crossplane、RayService、Pod、端点健康和失败原因汇总回
   Backstage，提供停止和回滚入口。

## 验收与回滚

- 每个级别先在对应的 stopped/CPU/NPU 范围内完成端到端验证后才提升；
- 自动化失败必须保留 Gitea、Tekton 与 Backstage 的 request ID 关联证据；
- 回滚运行时：停止/暂停对应 XR 或将所生成 Git 变更回滚，Argo 同步该受控 Application；
- 回滚自动化：关闭该 Application 的 automated Sync 与 merge bot，不需删除已验证制品；
- 任何阶段不允许 Backstage 拥有集群级 Kubernetes 写权限或 Secret 读取权限。
