# Model Deployment 列表与运行详情页方案

## 1. 页面结构

页面作为完整 Backstage 应用页面呈现，保留现有左侧导航、顶部应用栏和页面级操作区；
主内容采用与训练请求页面一致的左右分栏：

```text
左侧部署列表                         右侧运行详情
┌ Model Deployments     New ┐       ┌ Deployment details ┐
│ 动态部署卡片               │       │ 状态摘要             │
│ Running / Pending / ...    │  ->   │ Pipeline进度         │
│ 模型、Profile、NPU、阶段    │       │ Start/Stop/Update     │
└───────────────────────────┘       │ 配置、健康、事件       │
                                    └──────────────────────┘
```

- 左侧卡片左对齐纵向排列，点击后切换右侧详情。
- 右上角 `New deployment` 跳转到现有模型选择 -> 参数选择 -> Start 流程。
- 右侧详情始终显示当前状态、正在执行的阶段、资源、Service 和最近事件。

## 2. 状态与阶段

统一展示阶段：

```text
Request -> Git PR -> Tekton -> Argo -> Crossplane
        -> RayCluster -> Model loading -> Healthy
```

部署状态使用：`Pending`、`Validating`、`Deploying`、`Running`、`Stopping`、
`Stopped`、`Failed`。右侧同时显示阶段原因，避免只有 Pod 状态而不知道流程卡点。

## 3. 操作规则

- `Running`：显示 Stop、Update、Rollback、Open endpoint。
- `Stopped`：显示 Start、Update configuration。
- `Pending/Deploying/Stopping`：禁用冲突操作，仅保留 View pipeline 和 Logs。
- `Failed`：显示 Retry、Rollback、Stop，并突出失败阶段和建议。
- Stop 始终优先于 Start/Update。

## 4. 数据来源

扩展现有 `/api/model-platform/deployments`，聚合：

- ModelDeployment desiredState/conditions；
- Gitea PR 和 commit；
- Tekton PipelineRun/TaskRun；
- Argo revision/sync/health；
- Crossplane conditions；
- RayService active/pending、RayCluster 和 Pod；
- 实际 NPU annotation、Serve health 和稳定 Service；
- 生命周期控制器状态与最近事件。

前端每 5–10 秒刷新，并保留当前选中卡片。第一版继续使用已有 Scaffolder
Start/Stop action，不从页面直接调用 Kubernetes。

## 5. 实施顺序

1. 先实现列表/详情静态布局和状态组件。
2. 扩展只读聚合 API 和状态归一化。
3. 接入现有 Start/Stop 模板链接。
4. 接入 Pipeline 阶段、失败原因和事件。
5. 增加 Update/Rollback 后再开放对应按钮。

HTML 原型见 `prototypes/model-deployment-dashboard-v1.html`。

## 6. 当前本地实现状态（2026-09-01）

已在 Backstage 本地工作树完成、尚未提交或发布：

- 新增 `/model-deployments` 完整应用页面，沿用 Backstage 左侧导航和顶部框架；
- 左侧动态部署卡片、搜索和状态筛选，右侧部署详情、阶段、健康和事件；
- `New deployment` 接回现有模型选择与参数配置页；
- Start/Stop 接回现有 Scaffolder GitOps 模板，不允许前端直接写 Kubernetes；
- 后端聚合 ModelDeployment、Gitea、Tekton、Argo CD、Crossplane、KubeRay、
  Pod/NPU annotation、Service 和 Event；
- 只按部署对应的生命周期分支、revision 或 PR 编号关联 Tekton，未知或不可用状态
  不提升为成功；
- 状态接口单模块失败时保留其余模块数据，前端保留上一次成功结果并提示 stale；
- 已准备 Tekton、RayCluster/Event 和单个 Argo Application 的最小只读 RBAC 草案。

本阶段暂缓：

- Update、Rollback、Logs 按钮保持禁用，等各自受控后端能力完成后再开放；
- Gateway 状态固定显示 `NotConfigured`，后续由 Gateway 模块接入；
- RBAC、生产镜像和 Backstage Deployment 均未 apply，需统一发布审查后执行。
