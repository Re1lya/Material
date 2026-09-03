# 模型部署运行链路优化方案

> 文档类型：Model Deployment Dashboard v2 发布后的实施路线。
>
> 目标是在不破坏现有 v1 回滚能力和平台配置 GitOps 的前提下，缩短部署等待、
> 提供真实的推理健康状态，并最终让开发者只通过 Backstage 完成日常模型操作。

## 1. 目标边界

- Dashboard 统一展示部署、参数、阶段、事件、日志入口和 Start/Stop。
- 区分控制面就绪、Pod 就绪、Ray Serve 就绪和模型真实可推理。
- 将点击到控制器开始 reconcile 的时间降到秒级或一分钟内；模型加载时间单独衡量。
- 日常 Start、Stop 和有界参数调整最终不再依赖 Gitea PR。
- Gitea、Tekton 和 Argo CD 继续管理 XRD、Composition、RuntimeProfile、镜像
  digest、安全策略和平台版本发布。
- 数据库保存操作历史、参数版本、审计和幂等记录；Kubernetes
  `ModelDeployment` CR 仍是运行期 desired state 的事实源。

## 2. 推荐实施顺序

### 阶段 1：完成并发布 Dashboard v2

1. 审查并合并 Dashboard、参数合同和 v2 Composition 候选。
2. 保留 v1 Composition 和上一 Backstage digest 作为回滚点。
3. 先安装 v2 XRD/Composition，再发布 Backstage；不直接切换正式实例。
4. 验证已有 v1 Stopped 实例仍为 `Synced=True/Ready=True`。
5. 页面暂不开放未实现的 Update、Rollback 和 Gateway 操作。

完成标准：页面、只读聚合 API、New/Start/Stop 入口和降级显示正常，且没有创建
NPU workload。

### 阶段 2：加入最小真实性保护并执行基线测试

在第一次完整 v2 Start 测试前，补充两项最小能力，避免错误结论：

1. 为每个阶段记录时间戳：点击、PR 创建、CI 开始/结束、合并、Argo 发现、XR
   generation、RayCluster 创建、Pod Scheduled/Ready、Ray Serve RUNNING、首次
   `/v1/models` 成功和首次对话成功。
2. 页面在真实 Serve 探测完成前最多显示 `Model loading` 或 `Serving pending`，
   不显示最终 `Healthy`。

随后执行一次受控 v2 Start -> 推理 -> Stop 基线测试，保存完整时间线、事件和
各组件有界日志。不要只用 Pod Running 时间作为部署完成时间。

完成标准：能够将 15--20 分钟拆分为每个阶段的明确耗时，并确认 Stop 后资源
清理和缓存保留边界。

### 阶段 3：按基线证据优化部署速度

优先处理控制面空档，而不是盲目缩短超时：

- Gitea 合并后主动触发 Argo refresh，避免等待仓库轮询。
- 精确 PR head 已完成完整校验时，合并后的 main Run 只做必要的轻量校验，避免
  重复执行同一套工作。
- 检查 Tekton Pod 调度、镜像拉取、Crossplane/provider reconcile 和 KubeRay
  reconcile 的实际等待时间，只调整有证据的轮询或退避参数。
- 在 A3 节点预拉取固定 digest 的 Ray/vLLM 镜像。
- 复用经过校验的模型缓存 PVC/READY 标记，不重复下载或重新生成缓存。
- 分别记录控制面耗时、模型加载耗时和首次请求预热耗时。

目标参考：Git/CI/Argo/Crossplane 控制面交接尽量收敛到 1--2 分钟；Ray/vLLM
加载时间根据模型和 NPU 实测单独设定，不通过伪造健康状态掩盖。

### 阶段 4：完成生产级健康与日志合同

最终 `Healthy` 同时要求：

- `readyWorkers == requestedWorkers`；
- Ray Serve application status 为 `RUNNING`；
- 稳定 Service 和 `serve-svc` 均存在；
- EndpointSlice 至少有一个 Ready endpoint；
- `/v1/models` 或约定健康接口在短超时内返回 200，且包含目标模型；
- 可选的一次小型预热/对话探针成功。

为 head/Serve 配置足够宽松的 startup probe 和真实 readiness probe。worker 的
Ray Actor/Serve Replica 日志不能只依赖 `kubectl logs`：应提供
`/tmp/ray/session_latest/logs` 的受控查询、标准输出转发或集中日志系统，并在
Dashboard 中展示对应日志入口和最近错误。

完成标准：页面不会在 vLLM 尚未可请求时显示 Healthy；失败能够区分调度、缓存、
Ray、模型加载、Serve endpoint 和推理探针阶段。

### 阶段 5：迁移日常模型操作链路

引入受限的 Model Deployment API：

```text
Backstage
  -> Model Deployment API
  -> Kubernetes ModelDeployment CR
  -> Crossplane Composition
  -> KubeRay / Ray Serve / vLLM
```

API 首期只允许：

- 创建经过 allow-list 校验的 ModelDeployment；
- Start、Stop；
- 修改 schema 允许的推理和副本参数；
- 读取状态、事件和历史版本；
- 回滚到已验证的参数版本和 Composition。

每次写入必须具有 request ID、幂等检查、乐观并发/resourceVersion、操作者审计和
可恢复的参数快照。API 使用最小权限 ServiceAccount，只能操作指定 namespace、
资源类型和字段合同。

Gitea/GitOps 保留用于低频平台变更，不再承载每一次 Start/Stop：

- XRD 和 Composition 版本；
- RuntimeProfile 和允许的参数范围；
- 运行时镜像 digest、容量与安全策略；
- 平台版本发布、审查和回滚基线。

数据库不是直接部署器。它保存部署索引、操作历史、参数版本和审计；发生恢复时，
运行状态以 Kubernetes CR 和 controller status 为准。

## 3. 为什么不直接先迁移数据库/API

先完成 Dashboard、时间线和真实健康合同，可以建立当前链路的可观测基线，并验证
v2 Composition 本身稳定。若先更换操作链路，GitOps、控制 API、健康状态和运行时
问题会同时变化，出现故障时难以判断根因。

因此推荐顺序是：

```text
Dashboard v2
-> 最小健康语义与时间线
-> v2 基线测试
-> 部署速度优化
-> 完整健康/日志合同
-> 日常操作迁移到 Deployment API
```

这与“先页面、再测试、再提速、再健康、最后改操作链路”的方向一致，只在测试前
增加了最小健康保护和时间线采集，确保后续优化使用可信数据。

## 4. 回滚与发布原则

- 每个阶段独立发布和验收，不把 Dashboard、健康探针和控制 API 一次性上线。
- v1/v2 Composition 并存；测试实例优先使用 v2，正式实例在验收后再切换。
- Backstage 始终使用 immutable digest，并保留上一生产 digest。
- Argo CD prune/self-heal 在本路线完成前继续保持关闭，除非另有专项审查。
- 控制 API 上线初期保留 GitOps Start/Stop 作为应急回滚路径，稳定后再移除。
