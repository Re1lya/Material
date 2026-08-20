# KCC 预训练面板集成方案（方案 A：宿主机网关验证版）

> 状态日期：2026-08-18
>
> 当前决策：本集成暂缓。先由 KCC 侧把现有宿主机脚本、配置、日志状态和
> kubeconfig 依赖工程化并迁移到 K3s，再由平台侧接入；当前 Backstage 面板继续
> 保持 mock/read-only，启动和停止能力保持禁用。
>
> 目标：在现有 Backstage 上做一个 LLM 预训练（`kcc_ray`）操作面板，
> 验证"表单 + 按键"代替"SSH + shell 命令"的可用性，阶段 A 不占用任何 NPU。
>
> 范围：只验证面板与 `kcc_ray` CLI 的集成链路；`kcc_ray` 本体零改动；
> server-00 单点、hostPath 依赖等工程化问题留给后续方案 B。

## 1. 现状前提

- `kcc_ray` 位于 `server-00` 宿主机 `/home/ywj/kcc`（安装目录 = `bin/`、`config/cluster.yaml`、`ray_startup_bundle/`、`log/`），通过 `kubectl`（`/home/ywj/.kube/k3s-learning.yaml`）操作 K3s `pretrain-ray` namespace。
- 训练控制面是 K3s 内的 Supervisor Job（固定调度到 server-00，hostPath 挂载安装目录）。
- Backstage v0.2.x 已部署在 `backstage` namespace，OIDC 登录、Catalog、只读 Kubernetes 视图和受限 Gitea PR action 已验证；自定义 Scaffolder action 已有先例。
- 训练集群与 Backstage 是**同一个 K3s 集群**。
- 当前没有正在运行的训练任务（最近一次 `qw3-jobs-1` 为 STOPPED）。

## 2. 目标与边界

### 2.1 目标

- 面板提供：节点/NPU 状态、任务状态 stepper、日志查看、启动/停止按钮。
- 使用者无需改 YAML、无需 shell，全部通过表单 + 按键操作。
- 阶段 A 全程零 NPU：只读能力全真实，启动能力"接线但锁车"。

### 2.2 边界

- 不修改 `kcc_ray` 任何代码、配置和训练模板。
- 不把安装目录从 server-00 挪走；不迁移 `log/` 状态。
- 启动/停止按钮后端有总开关（`ENABLE_START=false`），默认不可发车。
- 符合 AGENTS.md：未批准不创建 NPU 工作负载；网关不接触其他 namespace。

## 3. 集成框架（三层）

```text
Backstage（backstage namespace）
  ├─ 前端面板：节点状态卡片 / 表单 / 六阶段 stepper / 日志视图 / 操作按钮
  └─ 后端：自定义 Scaffolder action + proxy（复用现有 Gitea PR action 模式）
        │ HTTPS 单向（NetworkPolicy 限制，可后续收紧）
        ▼
kcc-gateway（新小服务，跑在 server-00 宿主机，如 FastAPI）
  ├─ 鉴权：校验调用方身份（初始可为受限令牌），记录操作审计
  ├─ 参数白名单：只透传 kcc_ray 预留字段，禁止任意参数/命令注入
  ├─ 总开关：ENABLE_START / ENABLE_STOP，默认 false
  └─ 调用现有 kcc_ray CLI（subprocess，原样执行）
        │ kubectl / 现有 kubeconfig
        ▼
K3s pretrain-ray：Supervisor Job → RayCluster → HCCL → Ray Jobs → torchrun
        ▲
        └─ log/ 状态目录（server-00 本地，阶段 A 不迁移）
```

## 4. 网关 API 设计（草案）

| 方法 | 路径                                  | 说明                                                    | 碰 NPU         |
| ---- | ------------------------------------- | ------------------------------------------------------- | -------------- |
| GET  | `/nodes/check`                        | 节点/NPU 健康与占用（`kcc_ray check`）                  | 否             |
| GET  | `/jobs/{runId}/status`                | Supervisor + 恢复状态 + Ray Job（`kcc_ray status`）     | 否             |
| GET  | `/jobs/{runId}/logs`                  | driver 日志；`?supervisor=1` 取外层日志                 | 否             |
| POST | `/jobs`                               | 创建任务（`kcc_ray start`），受 `ENABLE_START` 开关控制 | 是（关时拒绝） |
| POST | `/jobs/{runId}/stop`                  | 立即停止（`kcc_ray stop`），受 `ENABLE_STOP` 开关控制   | 只影响已有任务 |
| POST | `/jobs/{runId}/stop-after-checkpoint` | 等 checkpoint 一致后停止                                | 只影响已有任务 |
| POST | `/jobs/{runId}/cancel`                | 停 Job 并清理 owned RayCluster                          | 只影响已有任务 |

## 5. 表单字段（复用 kcc 预留字段）

- run-id（默认自动生成，面板展示为任务 ID）
- 模式：续训（默认）/ fresh 从零 / all-nodes 全节点
- 节点：active 多选 + spare 多选（不重叠校验；默认取 cluster.yaml 配置）
- 训练模板：下拉（`pretrain_150M.sh`，管理员可扩展）
- 拓扑变更确认：勾选"允许 world size 变化"（对应 `--allow-topology-change`）
- 高级（可折叠）：master port、各阶段超时、失败资源保留时长、成功后是否保留 RayCluster

YAML 和训练超参仍由平台工程师在 cluster.yaml / raycluster.yaml / 训练模板中维护，不进面板。

## 6. 阶段 A 实施步骤

1. **只读期**：网关先实现 check / status / logs 三个只读端点；面板接好节点卡片、状态 stepper、日志 tab。全部真实验证，零 NPU。
2. **UI 期**：启动/停止表单与按钮全部做完，网关侧开关默认关闭（`ENABLE_START=false`）。表单校验、确认弹窗、审计日志可全链路测试，但不会创建任何 Job。
3. **验收**：走一遍面板操作流程，确认与 shell 等效（check 结果一致、表单映射参数正确、日志可达）。
4. **真实验证（待 NPU 窗口批准后）**：打开开关，在批准时间窗内做一次真实端到端运行，再关回默认。

## 7. 验收清单（阶段 A）

- [ ] 面板 check 结果与 `kcc_ray check` 输出一致；
- [ ] 表单参数与 `kcc_ray start` 实际透传参数一致（无多余/缺失）；
- [ ] 开关关闭时 POST /jobs 被拒绝且记录审计；
- [ ] 只读端点全程不创建任何 Kubernetes 对象、不改变 NPU 占用；
- [ ] 未运行任何训练时，npu-exporter 观测无新增 NPU 进程；
- [ ] 现有 Backstage 功能（OIDC、Catalog、Gitea PR action）不受影响；
- [ ] 无凭据、无密钥写入仓库；kubeconfig 不出宿主机。

## 8. 风险与注意

- 鉴权：kcc_ray 本身无认证，网关必须绑定调用方身份并白名单参数。
- NPU 审批：真实启动前必须按 AGENTS.md 获得明确批准。
- server-00 单点：阶段 A 保留，不解决。
- 网关运行环境：server-00 上需 python3 + PyYAML + 有权限的 kubeconfig，与现有 CLI 环境一致即可。

## 9. 后续（方案 B 迁移，已列入延期任务）

2026-08-18 对生产 K3s 做了只读盘点：`ray-mangement` namespace 中已有
`quay.io/kuberay/operator:v1.6.0`，Deployment 为 `1/1 Ready`；集群已经注册
`rayclusters.ray.io`、`raycronjobs.ray.io`、`rayjobs.ray.io` 和
`rayservices.ray.io`（`ray.io/v1`），并存在 Ready 的 RayCluster 和历史 RayJob。
因此后续不得再部署第二套 KubeRay Operator。

恢复本任务前必须先完成 KCC 控制包迁移：将宿主机脚本和固定路径依赖容器化，
把 `log/`/状态持久化，使用集群内 ServiceAccount/RBAC 替代宿主机 kubeconfig，
并提供稳定的只读状态接口。迁移验收后，再设计平台业务
`PretrainingJob` CRD 和一个轻量业务 Operator，把受控的训练意图转换为
`RayJob`；实际 RayCluster/RayJob 生命周期继续交给现有 KubeRay Operator。

在迁移和独立评审完成前，不部署网关、不创建业务 CRD/Operator、不授予 Ray
写权限，也不让 Backstage 创建或修改任何 Ray/NPU 资源。

## 10. 当前前端实现（2026-08-18）

Backstage app 的两个页面位于 `app/packages/app/src/modules/kccPretraining/`：

- `/kcc-pretraining` 展示 ModelScope revision、CPU-only importer、Artifact Keeper
  manifest、Gitea ModelVersion 和 Tekton/Argo/Crossplane 门禁；没有启动/停止训练按钮，
  也不显示虚构的节点/NPU 数值。
- `/model-recipes` 展示已提交 ModelVersion/ModelRuntimeProfile 的只读快照和停止态
  resolved recipe。部署按钮进入受限 Scaffolder 模板，由后端创建 Gitea PR，不在浏览器
  内生成 mock 成功结果。

页面的实际写入链路为：

```text
Backstage Scaffolder -> Gitea PR -> Tekton -> 人工合并 -> Argo CD Sync -> Crossplane
```

当前 Qwen3.8 只有模板，未被页面伪造为可部署模型；页面仍可展示已提交的 Qwen3.6
目录快照，用于验证请求、校验和停止态 GitOps 链路。发布页面仍需单独构建 AMD64 镜像、
核对 immutable digest、执行 server-side dry-run 并获得 Backstage Deployment 发布批准。

详情见 `model-deployment-recipe-mock-record-20260818.md`；该文件记录的是从 mock
交互到 GitOps 入口的调整，而不是模型运行发布。
