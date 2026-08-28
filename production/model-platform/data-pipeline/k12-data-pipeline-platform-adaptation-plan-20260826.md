# K12 数据管线与 Dagster 平台化接入方案

> **已被 `k12-platform-integration-plan-20260827.md` 取代。** 本文记录的是 2026-08-26
> 的旁路 CPU-only foundation 设计。后续方案以 K12 PR #2 的完整业务管线为唯一实现，
> 只重建其平台化交付、配置、身份和部署方式。

> 状态：设计与只读盘点完成，**尚未创建任何新版资源**。
>
> 日期：2026-08-26
>
> 范围：将 `panxy1019/kcc` 的
> `feature/k12-data-pipeline-dev/app/data_pipeline` 逐步接入现有模型平台。
> 本文不授权修改现有 `k12` 工作负载、不授权启动 NPU、也不授权删除旧 Dagster。

## 1. 结论

GitHub 仓库已经具备较完整的工程化材料：Python 包、Dockerfile、Helm Chart、环境
values、数据合同、Dagster 定义、Ray 配置、校验与部署脚本。它是新版数据管线的
**候选实现**，但尚未适配本平台的 GitOps、镜像供应链、身份、持久化、资源门禁和
NPU 治理。

生产集群中已经运行的 `k12/mineru-dagster` 是一套旧式、手工维护的 Dagster：代码和
Dagster 状态均来自 `server-00` 的 HostPath。它不能被 GitHub 仓库中的 Helm Chart
直接就地覆盖。

正确路线是旁路迁移：先在新 namespace 建立不含 Ray/NPU 的 GitOps 化控制面，再以
MinIO staging prefix 验证 CPU-only 流程；最后才将经审批的 Ray/NPU 工作流迁移到新
控制面。旧 `k12` 在新链路验收前保持不动。

本方案的自动化目标不是无人值守地任意启动 NPU，而是把当前的“工程师 SSH 后依次运行
脚本”改为可重复、可审计的发布与运行链路：代码变更自动验证和发布；新的数据 batch
自动进入 CPU 数据处理；NPU 阶段由明确的策略和审批门禁决定何时入队、何时启动、何时
归零。

## 2. 现有生产事实（2026-08-26 只读盘点）

### 2.1 集群基础能力

- 生产 K3s 有 10 个 Ready 节点：`server-00` 控制面、`a3-server-00` ARM64 Ascend
  节点及多台 GPU worker。
- 已安装 KubeRay Operator（`ray-mangement/kuberay-operator`，Ready），并已注册
  `RayCluster`、`RayJob`、`RayService`、`RayCronJob` CRD。不得部署第二套 Ray
  Operator。
- 当前 `k12` namespace 没有 `RayCluster`；其他 namespace 中已有独立 RayCluster，
  因此新数据管线不得修改或占用它们。

### 2.2 现有数据湖

`k12-lake` 已有运行中的单副本 MinIO：

| 项目 | 当前值 |
| --- | --- |
| StatefulSet / Pod | `minio-k12` / `minio-k12-0`，Ready |
| 存储 | 500Gi RWO `local-path` PVC |
| 集群内 S3 入口 | `minio-k12.k12-lake.svc.cluster.local:9000` |
| 集群外 API 入口 | NodePort `30900` |
| Console | NodePort `31901` |

新版数据管线应把它作为**外部 S3 依赖**复用；禁止新 Chart 再创建第二个 MinIO、PVC、
bucket root Secret 或数据湖生命周期。

### 2.3 现有旧 Dagster

当前工作负载为 `k12/mineru-dagster`：

| 项目 | 当前值 |
| --- | --- |
| 形态 | 一个 Deployment，包含 `webserver` 与 `daemon` 两个容器 |
| 入口 | NodePort `30080` |
| 节点 | 固定在 `server-00`（amd64） |
| requests | webserver `2 CPU / 4Gi`，daemon `1 CPU / 2Gi` |
| 实际观测 | 约 `54m CPU / 872Mi` |
| 代码来源 | HostPath `/home/admin/testpanxy/ray_job_test/mineru_dual_npu_20260717` |
| Dagster 状态 | HostPath `/home/admin/testpanxy/ray_job_test/dagster_home` |
| 对象存储身份 | 直接引用 `minio-k12-root` 的 root key |
| RBAC | 可读取 Pod/ConfigMap，且可 patch `Deployment` |

Daemon 正在轮询 `ray_job_status_sensor`，当前无新 run；日志持续出现 code-server
heartbeat warning。该 warning 是旧服务后续迁移前需复核的运行风险，但不是本方案中
直接重启、修复或替换旧服务的授权。

## 3. 新旧实现的差别

| 维度 | 当前集群 `k12` | GitHub `app/data_pipeline` | 平台化目标 |
| --- | --- | --- | --- |
| 发布 | 手工对象与 HostPath 源码 | Dockerfile、Helm、脚本 | Tekton → Artifact Keeper → Gitea → Argo CD |
| Dagster 状态 | 服务器目录 | `emptyDir`/PVC/HostPath 可选 | 专用持久化状态，不用用户目录 |
| 数据湖 | 已有 MinIO | 可自建，也支持外部 S3 | 复用现有 `k12-lake` |
| 计算 | 当前没有 `k12` RayCluster | 可声明 Ray Head、CPU / MinerU / Qwen Worker | 先无 Ray，后复用现有 KubeRay |
| NPU | 旧控制面有 Deployment patch 权限 | 历史 values 含固定卡号与大规格 | RuntimeProfile + 审批门禁 + 默认零副本 |
| 模型路径 | 历史本地目录假设 | `hostPath`/PVC 配置 | 后续接 Artifact Keeper → 受控缓存 → PVC/只读挂载 |
| UI | 独立 Dagster NodePort | Dagster UI | Backstage 目录、状态与受控入口 |

## 4. 目标职责划分

```text
KCC GitHub 源码
  │  测试、Chart 渲染、镜像构建
  ▼
Tekton CI
  │  镜像按不可变 digest 发布
  ▼
Artifact Keeper /container-images
  │  环境配置经 PR 审核
  ▼
Gitea model-platform-config ──> Argo CD
                                   │
                                   ▼
                         新版 Dagster 控制面
                                   │  受控提交业务任务
                                   ▼
                           KubeRay / RayJob
                         ┌─────────┴──────────┐
                         ▼                    ▼
                 CPU 数据处理          审批后的 NPU Worker
                         │                    │
                         └─────── MinIO/S3 ───┘

Backstage：展示资产、Dagster run、Tekton/Argo 状态，并提交受限申请。
Crossplane：未来表示受控的平台意图，不取代 Dagster、Argo CD 或 KubeRay。
```

### 4.1 各组件的边界

- **Tekton**：测试 KCC 代码、导入 Dagster definitions、执行 Helm lint/template、构建
  镜像、推送 Artifact Keeper；不访问 NPU，不创建业务运行对象。
- **Artifact Keeper**：保存数据管线镜像、Chart/配置制品和模型版本；不作为 PDF、
  中间 JSONL、图片和训练数据的数据湖。
- **Argo CD**：将已审核的环境清单同步到 K3s；第一阶段仍保持人工 Sync、无 prune、
  无 self-heal。
- **Dagster**：资产目录、运行记录、失败重跑、向 Ray 提交已批准的任务；不持有 root
  S3 凭据，不加载模型，不任意 patch 既有 Deployment。
- **KubeRay**：继续管理 RayCluster/RayJob 生命周期；不另建 Ray Operator。
- **Crossplane**：后续提供 `DataPipelineEnvironment`、`DataPipelineRun` 或
  `PretrainingJob` 等受控申请对象。第一阶段不把普通 Dagster Deployment 或 Helm
  release 强行转换为 Crossplane resource。
- **Backstage**：统一入口与审批体验，不能直连创建任意 Ray/NPU 资源。

## 5. 自动化目标与人工边界

### 5.1 当前人工动作

目前仓库的业务代码在一次任务启动后已经具备 manifest、S3 进度、hash、成功标记和
resume 能力；但其外层交付与资源操作仍依赖人工：

| 现有人工动作 | 当前入口或依赖 | 平台化后的目标 |
| --- | --- | --- |
| 修改 Python 任务后发布 | 本地测试、手工 build/push、Helm upgrade | GitHub PR → Tekton → Artifact Keeper → 配置 PR → Argo CD |
| 创建环境 | 手工 namespace、Secret、RBAC、PVC、values | GitOps 清单和受控 Secret 引用 |
| 提交 Dagster Job | `run-dagster-job.sh` 或 Dagster UI | Backstage 受限申请 / Dagster Sensor |
| 新教材进入处理 | 运行采集脚本后人工选择 batch | manifest 入库后自动发现、验证和 CPU 入队 |
| 启动 MinerU/Qwen | `scale_mineru.sh`、`scale_qwen.sh`、固定卡号 | 已批准 Profile 的任务申请与 KubeRay/RayJob |
| 失败处理 | 人工查日志、决定重跑 | Dagster 状态、S3 progress、受控 retry/resume |
| 发布训练集 | 人工找输出目录并确认 | 生成 DataSetVersion / 发布报告，人工确认最终发布 |

### 5.2 第一版自动化边界

第一版应按风险把自动化划为三层：

```text
完全自动（不使用 NPU）
  源码 CI、镜像发布、GitOps 配置验证、manifest 校验、Stage 1 CPU 任务、
  进度记录、失败隔离、重复运行跳过成功输入、Backstage 状态展示。

受控自动（需要批准）
  MinerU / Qwen Stage 2：系统可自动排队、提交、观察和归零，
  但只有审批后的 DataPipelineRun 才能进入 NPU 队列。

始终人工决定
  数据源授权、NPU Profile/卡组、资源优先级、处理规则或 Prompt 变更、
  最终 Training JSONL 数据集发布。
```

这样“自动化”不会把新的 PDF 或一次代码变更直接变成未经审查的 NPU 工作负载。

### 5.3 两条自动链路

#### A. 代码发布链路

```text
开发者 GitHub PR（Python / Chart / 配置）
  → Tekton：pytest、Dagster Definitions import、Helm render、策略检查
  → 构建 AMD64 Dagster 镜像
  → Artifact Keeper 按 digest 发布
  → 自动创建 Gitea 环境配置 PR（仅变更 image digest）
  → 合并后由 Argo CD 进行受控同步
  → 新版 Dagster 加载新的 Definitions，新 Job 出现在 Dagster UI
```

Dagster 通过 `Definitions(... jobs=[...])` 加载 Python Job；**KubeRay Operator 不负责
把 Job 展示到 Dagster**。Operator 只在运行阶段把 Ray 对象变成真实 Pod。

Dagster Chart 使用 `Recreate` 更新策略。因此发布门禁必须先检查是否存在 active run：
有运行则延后滚动更新或显式批准维护窗口，不能在活跃数据生产中无条件重启 webserver/
daemon。

#### B. 数据运行链路

```text
授权采集器或人工上传
  → 原始 PDF / manifest 写入 MinIO
  → Dagster Sensor 发现新 manifest 并创建 CPU-only Run
  → Ray CPU worker 执行 Stage 1，持续写入 progress / _SUCCESS / failed 清单
  → 自动生成候选数据集版本和质量摘要
  → 等待 Stage 2 / NPU 审批
  → 批准后提交受控 MinerU/Qwen RayJob
  → Dagster Sensor 观察状态，完成后自动归零
  → 仅 verified 结果被汇集为待发布 Training JSONL
```

采集本身不能在第一版强制迁入 K3s：其依赖外部访问令牌、网络代理和数据来源授权。
第一版允许受控采集机或人工将 manifest 写入 MinIO；从 manifest 开始实现自动化即可。

## 6. 必须完成的平台适配

### 6.1 镜像与源码

1. 固定 KCC Git commit，而不是以分支名作为生产事实来源。
2. 使用仓库 `Dockerfile` 构建 Dagster 镜像；镜像发布到
   `110.120.0.3:30670/container-images` 并在清单中固定 digest。
3. 新版 Pod 不挂载 `/home/admin/testpanxy/...` 源码目录。
4. Python、Dagster、Ray、Daft 版本保持仓库规定的兼容矩阵：Python 3.11、Dagster
   1.13.13、Ray 2.48.0、Daft 0.7.19，升级必须单独 CI 验证。

#### 6.1.1 Artifact Keeper 发布身份已就绪（2026-08-26）

K12 数据管线的专用 Artifact Keeper Service Account
`svc-k12-data-pipeline-publisher` 已创建，目标是让 `server-00` 的受控构建过程将镜像
发布到唯一目的地 `110.120.0.3:30670/container-images`。该身份已经配置为仅匹配
Docker format 的 `container-images` 仓库，拥有 `read,write` 权限；它不是 Kubernetes
ServiceAccount，不产生 Kubernetes 工作负载，也不影响旧 Dagster 或 NPU。

2026-08-26 已将 Artifact Keeper backend 从 1.6.0 受控升级为 1.6.4（Helm revision 4）。
仅 backend 更新；PostgreSQL、Web、PV/PVC 未重建，更新后健康检查正常。专用 token 已在
`server-00` 的 root-only Docker config 中完成 Docker `login`、无害 probe image 的 push
及 pull 验证。这个配置只能由 root 读取，不能复制到 Git、Kubernetes Secret、Pod、构建
日志或 shell history。

此前的 `401` 由发布验证脚本错误地复用 `sudo -S` 与 Docker
`--password-stdin` 的标准输入造成，token 被 sudo 预读；不是 OCI `/v2/token` API 或
仓库配额的阻塞。后续构建必须先独立完成 sudo 认证，再让 Docker 单独从 root-only 临时
文件读取 token。具体身份边界、轮换和凭据路径见
`production/model-platform/identity-operations-20260825.md`。

### 6.2 S3 / MinIO 与数据合同

1. 复用 `k12-lake` MinIO，但创建新的、非 root 的 S3 access key。
2. 新凭据仅授予已批准 bucket/prefix；Secret 名称和 key 引用可进 Git，明文不得入库。
3. Pod 内使用集群 DNS，不通过 NodePort；MinIO、Kubernetes Service 和内部域名写入
   `NO_PROXY`。
4. 原始 PDF、MinerU、Stage 1、Stage 2、Training JSONL 必须使用独立 staging prefix。
   验证通过前禁止写既有 production prefix。
5. 保留 upstream 的 `_RUN_MANIFEST.json`、`_PROGRESS.json`、`_SUMMARY.json`、
   `_FAILED.jsonl` 与每文档 `_SUCCESS.json` 合同，作为重跑和审计依据。

### 6.3 Dagster 持久化与网络

1. 不使用旧 HostPath；不使用默认 `emptyDir` 作为生产运行历史。
2. 建议使用独立 Dagster PostgreSQL，或在第一阶段使用明确的专用 PVC。不得复用
   Backstage、Gitea 或 Artifact Keeper 数据库。
3. 新 Service 默认 `ClusterIP`。现有 `30080` 已被旧 Dagster 占用；新版 UI 由
   Backstage proxy/链接或受控 port-forward 暴露。
4. 新 namespace 使用 NetworkPolicy：允许 Backstage、DNS、MinIO、Dagster/Ray
   所需通信；默认拒绝无关 ingress/egress。

### 6.4 权限

1. 旧 `dagster-qwen-controller` 的 `Deployment patch` 权限不能复用。
2. 阶段一 Dagster ServiceAccount 仅有读取自身 Pod、日志、Service、Event，以及
   读取必要 ConfigMap 的权限；不允许创建/patch Deployment、RayCluster、RayJob。
3. 需要 Ray 写能力时，另建 namespace 级 Role，并只允许管理平台明确创建且带
   `app.kubernetes.io/part-of=k12-data-pipeline` 标签的对象。
4. NPU worker 不能通过通配 RBAC 或任意 namespace 的 scale 权限启动。

### 6.5 资源与 NPU 安全门禁

新 `production-safe` overlay 的不可变默认值：

```yaml
ray:
  enabled: false
mineru:
  enabled: false
  replicas: 0
  minReplicas: 0
qwen:
  enabled: false
  replicas: 0
  minReplicas: 0
```

并同时满足：

- 无 `huawei.com/Ascend910` request/limit；
- 无 NPU 驱动、DCMI、`npu-smi`、模型 HostPath 挂载；
- 控制面明确调度到非 NPU 节点；
- `ResourceQuota` 限制 NPU 为零；
- 初始不创建 Ray Head、CPU worker、RayCluster、RayJob、PVC 或模型缓存 Job；
- 每次从零副本切换到 CPU/Ray/NPU 都需要独立的资源评审与批准。

## 7. 分阶段实施计划

### 阶段 0：源码基线与只读对照

**目标**：确认 GitHub 定义与旧 Dagster 的资产、Job、S3 prefix、重跑语义的差异。

- 固定目标 Git commit，生成文件清单与依赖锁定证据；
- 只读导出旧 Dagster asset/job 名称、最近运行、环境变量名称和使用的 S3 prefix；
- 建立“旧 Job → 新 Dagster Job/Asset → 新 staging prefix”的映射；
- 不改变旧 Deployment、Service、HostPath、Secret、Role 或 NodePort。

**验收**：形成差异清单；无集群写入。

### 阶段 1：CI 与制品供应链

**目标**：让新版代码可重复构建、验证和发布，但不部署。

Tekton Pipeline 应包含：

1. Python unit test；
2. Dagster definitions import test；
3. `helm lint` 与 `helm template`（safe / CPU / NPU profiles）；
4. 策略检查：拒绝未批准镜像、未固定 digest、NPU 默认非零、历史 HostPath、root S3
   Secret、NodePort `30080`；
5. AMD64 Dagster 镜像构建，推送 Artifact Keeper；
6. 返回 immutable digest，并创建配置仓库 PR，而不是直接部署。

**验收**：CI 成功，Artifact Keeper 可按 digest 拉取；没有 Kubernetes 业务资源变更。

### 阶段 2：GitOps 化的零计算控制面

**目标**：部署新版 Dagster，但不启动 Ray、CPU 数据工作者或 NPU。

- 新 namespace：建议 `k12-data-pipeline`；
- 新 Dagster 镜像、专用 ServiceAccount、最小 Role、ClusterIP Service；
- 专用持久化存储与 scoped S3 Secret；
- Argo CD Application 只允许该 namespace 的明确 resource whitelist；
- 初始使用人工 Sync，`prune=false`、`selfHeal=false`；
- Backstage 中增加只读目录卡、Dagster UI 链接、健康与 release 状态。

**验收**：Dagster Ready、健康接口与 UI 可访问、可读取 staging S3 manifest；没有
RayCluster、RayJob、NPU Pod 或模型缓存 Job。

### 阶段 3：CPU-only 数据 smoke

**目标**：验证数据合同与重跑，不接触 NPU。

- 仅在独立 staging prefix 上运行少量 manifest；
- 若需 Ray，先启用小规格、明确 CPU nodeSelector 的 Ray Head/CPU worker；
- 只运行 Stage 1 或不依赖模型的 manifest/collector job；
- 检查输入 source SHA/ETag、输出 hash、`_SUCCESS.json`、失败隔离与 resume；
- 在 Backstage 显示 Dagster run、Tekton build、Argo revision 和 S3 输出摘要。

**验收**：重复运行不会覆盖无关对象；失败可恢复；NPU exporter 无新增进程。

完成 smoke 后，将 Stage 3 扩展为 event-driven CPU 处理：Dagster Sensor 只接收经过
manifest schema 校验且位于 staging prefix 的 batch。相同 batch id / source hash 的成功
对象被跳过；失败对象基于已有 progress 合同重试。Sensor 不得直接启动 MinerU/Qwen。

### 阶段 4：受控 MinerU / Qwen 验证

**目标**：在批准的空闲窗口验证一次最小端到端数据路径。

前置门禁：

- 目标节点、物理卡组、现有 Ray workload、CPU/内存/磁盘均经过只读确认；
- 模型从 Artifact Keeper 按 manifest/digest 缓存并校验完成；
- MinerU 与 Qwen 不共享同一物理卡组，也不与旧控制路径同时启动；
- 明确一项 `RuntimeProfile`、最大副本、超时、停止与回滚策略；
- 审批后才开启 Ray/NPU 写权限。

**验收**：仅启动批准的 worker，任务完成后排空并归零；输出质量门通过；无未拥有的
NPU 工作负载被修改。

### 阶段 5：迁移与旧系统退役

**目标**：将实际生产任务入口逐个迁移到新版，而非一次性切换。

1. 先迁移只读资产和 CPU-only Job；
2. 再迁移 MinerU smoke；
3. 再迁移经过审批的 Stage 2；
4. 每项对比旧/新产物和运行语义；
5. 旧系统连续无任务并完成导出/备份后，才单独评审下线。

旧 `k12/mineru-dagster` 的删除、缩容、重启、NodePort 回收或 HostPath 清理不属于本
方案的自动步骤。

## 8. Crossplane 的正确使用时机

Crossplane 当前已经承担模型 `ModelDeployment` 的受控声明式组合。数据管线不应在
第一阶段把每个 Helm Deployment、Dagster run 或 RayPod 都变成 Crossplane resource。

后续可新增一个业务 API，例如：

```text
DataPipelineRun
  spec:
    inputManifestRef
    processingProfileRef
    outputPrefix
    desiredState: Stopped | Approved | Running
  status:
    phase, dagsterRunId, rayJobRef, outputSummary, conditions
```

其边界应为：

- Crossplane/业务 Operator 负责校验申请、引用受限 profile、生成受控 RayJob 意图；
- Dagster 负责资产编排、run history、失败与重跑；
- KubeRay 负责实际 Ray lifecycle；
- NPU 开关必须经显式审批，不能由浏览器或 Dagster 任意参数绕过。

实施该 API 前，应先完成阶段 0–3，并单独审批 CRD、Operator、Ray 写权限与 NPU
端到端试验。

## 9. Backstage 接入范围

第一版 Backstage 只提供：

- K12 数据资产与 pipeline catalog 页面；
- 新/旧 Dagster 的清晰区分和链接；
- Tekton build、Argo CD revision、Dagster run 的只读状态；
- 选择已批准 manifest/profile 后创建 Gitea PR 的受限申请表单；
- 对 NPU 申请显示审批状态，不直接启动任务。

只有在阶段 4 验收后，才考虑允许批准后的 `DataPipelineRun` 从 Backstage 提交。

## 10. 需要修改的代码、配置与非修改项

### 10.1 应修改或新增

| 位置 | 工作 | 原因 |
| --- | --- | --- |
| KCC Python | 新 Job/Asset 必须注册到 `Definitions`；为新 RunConfig 增加 schema 校验 | 让新任务可在 Dagster 中发现且参数受限 |
| KCC Python | 将直接控制旧 Qwen Deployment 的 `QwenKubernetesResource` 替换为受控 Profile / API adapter | 消除固定 namespace、固定物理卡号与任意 patch 风险 |
| KCC Helm | 新增 `production-safe` overlay | 默认无 Ray、无 NPU、无 HostPath、ClusterIP、最小资源 |
| Material Tekton | 新增 KCC CI、镜像发布、Definitions import 与策略检查 | 自动化代码发布 |
| Material GitOps | 新 namespace、Argo Application、资源白名单、镜像 digest 清单 | 声明式部署与回滚 |
| Dagster 配置 | 外部 S3、专用持久化、运行配置/状态、Sensor policy | 消除 root Secret 和本机目录依赖 |
| Backstage | pipeline catalog、Run 状态、受限申请页面 | 统一入口与可见性 |

### 10.2 初期不应修改

- 不重写已经通过业务验证的 MinerU、Stage 1、Stage 2 清洗与质量规则；先通过测试和
  staging 结果确认其生产等价性。
- 不修改或重启当前 `k12/mineru-dagster`。
- 不把 Data Lake Chart 再部署一遍；复用现有 `k12-lake`。
- 不为任务展示另建 Kubernetes Operator；Dagster Definitions 和 Sensor 已承担展示与
  运行状态聚合。
- 不在阶段 0–3 启动模型缓存、MinerU、Qwen、Ray NPU worker 或修改现有 NPU workload。

## 11. 未决项与开始条件

开始任何生产写入前必须明确：

1. 固定的 KCC Git commit 与旧 Dagster 功能映射；
2. 新 namespace 名称、Dagster 持久化方案和资源预算；
3. MinIO 的 scoped access key 与 bucket/prefix policy；
4. Dagster 镜像的构建主机、Artifact Keeper 发布 digest 与 pull Secret；
5. Argo CD Application 的 resource whitelist 与人工同步责任人；
6. CPU-only staging prefix 和可接受的数据量；
7. NPU RuntimeProfile、卡组所有权及单独审批流程。

## 12. 相关材料

- KCC 源码：`https://github.com/panxy1019/kcc/tree/feature/k12-data-pipeline-dev/app/data_pipeline`
- 现有平台进度：`production/model-platform/progress-20260810.md`
- 平台总方案：`model-platform-production-integration-plan.md`
- KCC 预训练延后方案：`production/model-platform/backstage/kcc-pretraining-panel-plan-20260817.md`
- Agent 工作边界：`AGENTS.md`

## 13. 非目标

本方案当前不包含：

- 自动启动 NPU、修改现有 `k12` 或其他 namespace 的工作负载；
- 新建第二套 KubeRay Operator、MinIO、模型仓库或数据湖；
- 迁移或删除旧 HostPath 数据；
- 启用 Argo CD 自动同步、prune 或 self-heal；
- 在 Git 中保存任何密码、S3 key、Artifact Keeper token、kubeconfig 或渲染后的 Secret。

## 14. 工程化前供应链准备记录（2026-08-26）

本节记录的是 `server-00` 上的预热证据，不代表新版 K12 数据管线已经部署，也不代表
任何 NPU worker 被创建。

### 14.1 已确认的内部镜像

以下镜像已存在于旧兼容 Registry `110.120.0.3:8889`；它们在后续构建/迁移前必须按
摘要复核，不能只使用可变 tag。

| 用途 | 架构 | 兼容来源摘要 |
| --- | --- | --- |
| Dagster Webserver 基础 | amd64 | `mineru/ray-data:py3.11.13-ray2.48.0-daft0.7.19-dagster1.13.13-web-20260720@sha256:dc3cc0794b039b3db161cb2f573f21715c9d755f4ecf43c422a5eda89906f5e1` |
| Ray CPU Worker 基础 | amd64 | `mineru/ray-data:py3.11.13-ray2.48.0-daft0.7.19-dagster1.13.13-s3-compress-20260716@sha256:dafbc466b75ba12bb25bf4448b61c6d7a12f8def66fa04f16a45829927282e07` |
| MinerU 运行时 | arm64 | `mineru/mineru-vllm-a3:official-v0.11.0-20260715-ray248-lake-20260716@sha256:878cce76d3e954cbddec8d7870d8d7288ce1e561fc52a99cf2d5346efee026ae` |
| vLLM Ascend 运行时 | arm64 | `mineru/vllm-ascend-worker:v0.21.0rc1-a3-20260713-s3@sha256:d6f9824f0460e1bc814e4eb2466c5dfd5878b821263c42bd1d17cc9b0504cc28` |

AMD64 Dagster 基础镜像已在 `server-00` Docker cache 中。其离线依赖检查确认包含 Python
3.11.13、Dagster 1.13.13、Ray 2.48.0、Daft 0.7.19、Boto3 1.43.0、PyArrow、PyYAML
和 zstandard；但不包含 Pillow、pypdfium2 或 pytest。因此不能直接将它当作新版 KCC
运行镜像而不补依赖。

ARM64 镜像未在本阶段预拉到 `a3-server-00`，也未触发任何 K3s pull：该节点尚未完成
Artifact Keeper `30670` 注册与独立验证，且本阶段禁止 NPU workload。

### 14.2 已下载的离线 wheelhouse

为避免后续 KCC Dagster 派生镜像在构建时直接访问 PyPI，已使用可达的阿里云 PyPI
镜像下载到 `server-00:/mnt/data/k12-data-pipeline-prep/wheelhouse-cp311/`：

```text
runtime/
  Pillow==11.3.0
  pypdfium2==4.30.0
test/
  pytest==8.4.2
  iniconfig==2.3.0
  packaging==26.3
  pluggy==1.6.0
  pygments==2.21.0
```

总量约 11MiB。该 wheelhouse 已在网络禁用的临时容器中以
`pip install --no-index --find-links ...` 安装并完成 import 验证。它是构建缓存，不是
生产运行时 PVC，也不应直接作为 Pod 挂载。

后续 Dockerfile 应把经复核的 wheelhouse 纳入构建上下文并使用 `--no-index` 安装，
然后将最终 AMD64 镜像发布为 Artifact Keeper 中的不可变 digest。`server-00` 已具备
专用、repository-scoped publisher 登录态；构建任务通过 root-only Docker config 使用它，
不得读取或导出配置内容。构建/推送完成后仍须返回非敏感的 Registry manifest digest 与
`linux/amd64` 架构证据，之后才允许创建承载该 digest 的 Gitea 环境配置 PR。

### 14.3 首个 AMD64 Dagster 控制面镜像（2026-08-26）

首个 CPU-only 控制面镜像已从 KCC 固定源码 commit
`2fd605cfe572470f582c4ef9575a5382dd6f9ff2` 构建并推送；其目的仅是为后续新版 Dagster
控制面提供经验证的镜像输入，**尚未创建任何 Kubernetes 资源，也没有部署、重启或修改
旧 `k12/mineru-dagster`**。

| 项目 | 已验证事实 |
| --- | --- |
| 平台派生 Dockerfile | `production/model-platform/data-pipeline/image/Dockerfile.dagster-amd64`，SHA256 `71d85170fca31abad5e70ed0f83e57cc0fbd50136daf326e572e81083e1f7ac3` |
| 基础镜像 | 内部 `mineru/ray-data` AMD64 Dagster/Ray 基础，固定 `sha256:dc3cc0794b039b3db161cb2f573f21715c9d755f4ecf43c422a5eda89906f5e1` |
| 构建网络 | `docker build --network=none`；仅从本地 wheelhouse 安装 Pillow 11.3.0 与 pypdfium2 4.30.0 |
| 发布引用 | `110.120.0.3:30670/container-images/k12-data-pipeline-dagster:0.2.0-2fd605c@sha256:cab853ebd172aa4b04e37d899331448bfad375f7f4c26ba1bb086d518c5bdb89` |
| Registry 架构 | OCI index 中唯一运行镜像 child manifest 为 `linux/amd64`，`sha256:388f5d605afd4cc1947bf1aafd0e2ff479079ae1169ef2bd5bcbe53185991cf6`；另一项为构建 attestation，不是可运行平台 |
| 本地功能验证 | 离线容器内导入 Pillow、pypdfium2、Dagster 1.13.13、Ray 2.48.0 与 `clean_qa.mineru_dagster.definitions` 均成功 |

派生 Dockerfile 不使用上游默认的公网 `python:3.11-slim`，也不在 build 时运行 apt/pip
公网下载。它不包含 NPU runtime、Kubernetes 凭据、Secret、HostPath 或资源请求。此镜像
已可作为下一阶段 production-safe Dagster Chart/CI 的 digest-pinned 输入；那是独立的
GitOps 和人工同步变更，不能把本次 Registry push 误认为已经部署数据管线。

### 14.4 安全收紧与自动化路线（2026-08-27）

后续源码审阅发现固定 KCC commit 的 upstream Dagster location 会注册历史 Ray/NPU
控制 Job。它不能原样暴露给 Backstage 或用于第一版控制面。因此 14.3 的已发布镜像只可
作为构建输入证据，**不是可 apply 的第一版 foundation image**。

下一镜像会仅加载平台自有的 `platform_control_plane.definitions`，不公开任何可执行 Job；
新版 foundation 同时具备非抢占 PriorityClass、CPU/内存/Pod 上限和
`requests.huawei.com/Ascend910: 0` 配额。完整架构、容量复核和后续 Gitea CI / Backstage
run / Dagster 监控分层见
`k12-data-pipeline-automation-mvp-20260827.md`。

### 14.5 安全控制面镜像发布（2026-08-27）

平台自有的空 Dagster location 已使用 `--network=none` 离线构建并发布为：

```text
110.120.0.3:30670/container-images/k12-data-pipeline-dagster:0.3.0-control-plane@sha256:c5f80cd6f09becb3493745416f2020ebc3f667f904ff5c8e477be5f524b1e5ba
```

Registry 检查确认其可运行 child 为 `linux/amd64`；离线容器检查确认该 location
加载后不公开任何 Dagster job。`foundation/` 和 Backstage 配置均已固定到这个
digest。此次只新增 Artifact Keeper 镜像：没有创建 `k12-data-pipeline` namespace，
没有创建 Pod/PV/PVC/Secret，也没有修改旧 `k12/mineru-dagster` 或任何 NPU workload。

该镜像是阶段 B CPU-only foundation 的唯一允许镜像输入；它本身不等于已部署。
