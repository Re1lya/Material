# Running 门禁与首次受控启动记录 — 2026-08-28

> 本文记录 Running/NPU 阶段的前置开发、发布、首次受控启动尝试与
> 主动回停（Stop）的完整证据。密码、Token 与 Secret data 不进入本文。
> 当前平台最终状态：qwen38-27b 回到 Stopped 基线，零 NPU。

## 1. 已发布并验收的组件

### 1.1 Running 合并门禁（Tekton Pipeline generation 14）

Pipeline `model-platform-ci/validate-model-platform-config` 新增两个 Task：

- `capacity-gate-running`：以专用只读 ServiceAccount
  `model-platform-ci/model-capacity-reader` 运行（PipelineRun taskRunSpecs），
  挂载 ConfigMap `model-platform-running-gate-policy`，执行：
  1. 非 `backstage/modeldeployment-running-` 分支直接跳过；
  2. 运行窗口检查（`window-open`，默认 false，fail-closed）；
  3. 目标 XR 必须为 Stopped 且 Synced/Ready；
  4. 版本化 cache Job `<name>-cache-<revision>` 必须 Complete；
  5. 目标节点 label 必须匹配 Profile（a3-server-00/arm64/Ascend910/module-a3-16）；
  6. 目标节点上任何 namespace 不得存在其他 Ascend/NPU 请求 Pod；
  7. 经 kube-apiserver 服务代理只读查询 Prometheus，目标物理设备
     （Ascend910-8,9）必须 health=1 且 process=0（双视角的物理面）。
- `auto-merge-running-request`：仅接受 backstage 生成分支，单文件 changed，
  基于 base/head 两个 revision 的 Contents API 内容执行：
  - base 必须为合法 Stopped 请求；head 必须 Running + workerReplicas=1 +
    npuPerWorker=2 + effective 注解四元组 + requested-start-id；
  - runtime image / manifest digest / cache revision / compositionRef 与
    策略 ConfigMap 逐一比对；requested-by 必须在单租户 allow-list；
  - diff 白名单：仅允许 desiredState、workerReplicas、start 相关注解与
    requested-by 标签变化，其余深比较相等；
  - 主上不得已有相同 start-id 或另一个 Running 请求；
  - 满足后以 head_commit_id 合并并删除分支。
- 原 `auto-merge-stopped-request` 增加软跳过：非 Backstage 分支与 running
  分支不再导致平台类 PR 校验失败。

### 1.2 RBAC 与网络（最小权限）

- ClusterRole `model-capacity-reader`：nodes/pods/events get,list。
- Role `model-capacity-reader-serving`（model-serving）：jobs、
  ray.io rayservices/rayclusters、platform.example.com modeldeployments get,list。
- Role `model-capacity-reader-prometheus`（monitoring）：仅
  `services/proxy` `promotel-kube-prometheus-s-prometheus`（含 http:/https:
  完整 resourceName 形式）get —— Prometheus 只读经 API server 代理，
  无需放行新网络出口。
- NetworkPolicy `allow-dns-and-kubernetes-api` 增加
  `110.120.0.3/32:6443`：K3s 策略匹配 DNAT 后的 API server 真实 endpoint，
  10.43.0.1 的 ipBlock 规则在 DNAT 后不生效。该命名空间 runner 仍无 token。
- 监听器 Role 的 impersonate 列表新增 `model-capacity-reader`。

### 1.3 策略 ConfigMap

`model-platform-ci/model-platform-running-gate-policy`：allow-list
（gitadmin）、window-open（默认 false）、认证 image/manifest/cache
revision/composition、目标节点 label、目标设备 Ascend910-8,9。
由管理员在受控窗口时人工开启/关闭。

### 1.4 Schema 扩展（Gitea PR #12）

ModelDeployment 注解白名单新增 `requested-start-id`（正则约束）与
`requested-start-reason`。PR #12 经 Tekton 校验后人工合并
（head 36b4cea05cc51dd65b315ef4544cb7978c6663e5，合并 commit 10971d0d 前），
期间发现并修复了平台类分支（platform/*）触发 stopped 合并任务误报的问题。

### 1.5 Backstage Start-inference（0.1.6.1）

- 新增受限 action `model-platform:gitea-start-inference-pr`：校验发起人
  allow-list、目标文件必须为已存在的 declarative-stopped + Ray composition；
  生成 `backstage/modeldeployment-running-<name>` 分支与 Running PR，
  记录 start-id/reason/requested-by；重复 open PR 检测。
- 新增模板 `catalog/templates/model-deployment-start.yaml` 并注册 location。
- 镜像 `platform/kcc-backstage:0.1.6.1-running-start-20260828`
  @sha256:1f5d475c34dd7c6c1b0638a5bc2cf4f13a428da0f7aa0bbad791683a9a72fe17
  （linux/amd64，server-00 构建）已滚动上线：Pod 1/1、/healthcheck 200、
  /model-recipes 200，scaffolder 日志确认 action 已注册。

## 2. 门禁负向与正向冒烟（均真实生产执行）

### 2.1 负向：窗口关闭时必须拒绝（PR #14）

- 构造 `backstage/modeldeployment-running-qwen38-27b` Running 请求 PR
  （head 2ea825578495，PipelineRun `jx4z5`）。
- 结果：clone-and-validate Succeeded；capacity-gate-running StepFailed，
  日志 `capacity_gate=FAIL approved running window is closed`；
  running 合并被跳过；PR 未合并；commit status 报告 failure。
- 测试 PR 已关闭并删除分支，未留下任何 Git 变更。

### 2.2 过程中发现并修复的两个发布问题

1. capacity gate 首跑 `Connection refused`：K3s NetworkPolicy 在 DNAT 后
   匹配，需放行 `110.120.0.3/32:6443`（见 1.2）。
2. Prometheus 代理 403：`services/proxy` 的 resourceName 必须使用请求路径
   的完整 `http:<name>:<port>` 形式（见 1.2）。

### 2.3 正向：受控窗口内的全自动 Running 链路（PR #16）

窗口开启（window-open=true）后创建正式 Running 请求
（requested-by: gitadmin，start-id: start-20260828-window1，head
321f617c98d317d29df425070308c5664b465b1b，PipelineRun `pfk7p`）：

```text
clone-and-validate            Succeeded
capacity-gate-running         Succeeded   （双视角容量检查全绿）
auto-merge-running-request    Succeeded   （PR #16 自动合并）
report-gitea-commit-status    Succeeded
```

- PR #16 merged=True；Gitea main 合并 commit
  `10971d0d9858652977156801b65664923a3223ca`。
- Argo automated sync 物化该 commit；XR qwen38-27b 变为
  desiredState=Running / workerReplicas=1，Synced=True。
- Crossplane Composition 将 RayService 更新为 workerReplicas=1、
  npuPerWorker=2；KubeRay 重建 RayCluster qwen38-27b-d2h98，worker Pod
  创建并请求 `huawei.com/Ascend910: 2`、CPU 48、memory 256Gi、
  runtimeClassName=ascend、staticDeviceAllocation 注解 Ascend910-8,9。

### 2.4 阻塞点：Volcano gang 调度失败（已知问题复现）

worker 与 head PodGroup 停留 Pending，Volcano 事件：

```text
2/2 tasks in gang unschedulable: pod group is not ready
0/10 nodes are unavailable: 1 Insufficient cpu,
  1 node npu top<[0 1 10 11 12 13 14 15 2 3 4 5 6 7 8 9]> is invalid,
  8 plugin NodeAffinity predicates failed
```

诊断（只读）：

- 节点实际资源充足（a3 CPU 请求仅 0%、NPU 0/16），"Insufficient cpu"
  是插件失败后的 gang 误判；
- `volcano-npu_v26.1.0` 插件（MindX 拓扑、useClusterInfoManager=true）
  将 a3 节点拓扑判为 invalid——与 `qwen38-ray-tp2-execution-20260819.md`
  记录的历史失败一致；
- KubeRay operator 以 `--batch-scheduler=volcano` 运行，会在 Pod 层强制
  覆盖 RayCluster 模板中的 `schedulerName: default-scheduler`，
  因此 Composition 层面的调度器设置在当前部署形态下无法生效。

2026-08-19 的历史成功正是在临时移除 operator 的
`--batch-scheduler=volcano` 后取得，随后已恢复。本阶段遵守任务约束，
未修改 Volcano/KubeRay 全局配置。

## 3. 主动回停（Stop）与基线恢复

- Gitea main 直接提交 `bbd90fe97da7` 将 qwen38-27b.yaml 回退为 Stopped
  合同（回退即 Stop 的 Git 事实源操作）。
- Argo automated sync 自动同步 `bbd90fe9…`；XR 回到
  Stopped / workerReplicas=0 / Synced=True；RayService workers=0。
- 删除卡在 Pending 的 RayCluster（operator 持有的子对象），KubeRay 按停止
  模板重建 head-only 集群：head Pod 1/1 Running（CPU-only），
  worker=0，NPU requests 全程为 0。
- 策略 ConfigMap `window-open` 已关闭（false）。
- 全程未触碰 ds/k12/ray-demo/训练业务与任何全局调度配置。

## 4. 结论与遗留决策

已验证（生产证据）：

- Running 请求的机器门禁、自动合并、自动同步、Crossplane/KubeRay 下发
  链路全部可用；Stop 优先与自动同步回退可用。
- 唯一阻塞是既有 Volcano/MindX NPU 拓扑插件缺陷（非本阶段引入）。

遗留决策（需用户/验收方裁定）：

1. 批准一次受控的 KubeRay operator `--batch-scheduler` 临时摘除窗口
   （2026-08-19 先例）以完成首次 NPU Running 验收；或
2. 安排 MindX ClusterInfoManager / volcano-npu 插件兼容性修复窗口；或
3. 维持 Stopped 基线，将 Volcano 兼容性作为 Running 阶段的正式阻塞项。

## 5. 2026-08-30 A3 selector 探针与 Stopped 合同修复

在确认 A3 物理设备 8/9 健康为 1、进程数为 0，且 Kubernetes 中只有既有
K12 工作负载占用互不重叠的 14/15 后，执行了两次隔离在
`model-serving-diagnostics` 的最小 RayCluster 探针。两次探针均不挂载模型、
不启动 vLLM、不创建推理 Service，并在结束后删除诊断 namespace。

第一轮增加以下调度合同：

- head/worker 均选择 `accelerator-type: module-a3-16`、A3 hostname、ARM64 和
  Ascend910；
- CPU-only head 使用 `huawei.com/skip-ascend-plugin: enabled`；
- worker 请求 2 个 NPU，并声明静态 8/9。

结果：Volcano PodGroup 变为 `Running`，head/worker 均成功绑定 A3，历史
`npu topology invalid` 不再出现；但 device-plugin 将实际
`huawei.com/Ascend910`/`AscendReal` 重写为 12/13。探针 head 仅配置 2Gi，随后
OOMKilled；该问题属于探针资源不足，不影响调度结论。

第二轮将 head 内存提高至 16Gi，并在确认 12/13 双视角空闲后声明静态 12/13。
head 与 worker 均进入 Running，PodGroup `Running`、available worker=1，证明
`module-a3-16` selector 与 head skip 能修复 Volcano gang/topology 阻塞；但最终
实际设备又被改写为 10/11，而 `huawei.com/kltDev` 仍为 8/9。由此确认当前
Volcano/MindX 路径不能保证请求的静态卡号等于容器实际设备。

随后通过 Gitea PR #23 将 `accelerator-type: module-a3-16` 固化到正式
`qwen38-27b` Stopped nodeSelector，并同步更新 JSON Schema 与 Python 策略校验。
PR head `10e4d278461f7dc895b9afb91455c0f28389f901` 和 merge commit
`1a37781f08c170a15bf9cfe65e805270cb4d59ff` 均通过 Tekton；Argo scoped
auto-sync 后 Application `Synced/Healthy`。XR 为 Stopped、worker=0、
Synced/Ready/Responsive=True；新 head-only RayCluster Ready，零 NPU。

剩余 Running 决策：若必须维持固定 8/9 合同，需要批准受控窗口临时移除
KubeRay Operator 的 `--batch-scheduler=volcano`，复用历史已验证的
default-scheduler 静态分配路径；若保留 Volcano，则必须把容量门禁重构为动态
安全设备池，并增加调度后的实际 `AscendReal` 校验和冲突时自动 Stop。在完成其中
任一方案前，不得把正式 Qwen 切回 Running。

## 6. 2026-08-30 动态安全卡池与 Backstage 状态反馈

用户确认不再要求固定物理卡号，只要求固定到目标空闲节点并将实际状态反馈到
Backstage。平台据此保留 `a3-server-00/module-a3-16` nodeSelector，移除
`qwen38-27b.spec.placement.staticDeviceAllocation`，由 Volcano/MindX 动态选择
拓扑合法的两张卡。

Tekton Pipeline generation 15 将 Running capacity gate 改为动态安全池：读取 A3
全部 16 卡的 Prometheus health/process 指标，解析节点上现有 NPU Pod 的实际设备
annotation，允许 K12 等已声明且不冲突的设备，要求所有 Kubernetes 未声明设备均
health=1 且 process=0，并要求剩余数量至少为 2。现有 NPU Pod 缺少完整设备 annotation
时 fail-closed。策略 ConfigMap 的 window 继续为 false。

Gitea PR #24 删除固定卡号并同步 validator：head
`9a0841426eacdc559f55dcc5332beac7e2ccaa64`、merge commit
`f41ef9b075b2f14a7244dac2a242cfa2635e0d43` 均通过 Tekton；Argo 同步后 XR 为
Stopped/Synced/Ready、worker=0，渲染后的 Ray worker 不再有静态 Ascend910
annotation。

Backstage `/api/model-platform/deployments` 首次验收返回 503，根因是生产
`model-serving/backstage-read-only` Role 落后于源码，缺少 PVC 和 RayService 的
只读权限。仅补 `persistentvolumeclaims` 与 `rayservices.ray.io` 的
get/list/watch 后接口返回 HTTP 200；ServiceAccount 仍不能读取 Secret 或创建
Deployment，Backstage 已能显示 Qwen Stopped/Synced/Ready 和聚合资源计数。

最终 Running 前检发现 A3 device 0 存在两个无 namespace/pod/container ID 的宿主机
进程（PID 3653702、3654383），而 Kubernetes 只记录 K12 使用 14/15。由于 Volcano
可能动态选择 device 0，generation 15 会按设计拒绝启动。未开启 Running window、
未创建 Running PR、未申请 Qwen NPU。只有该宿主占用被责任人确认释放后，才可继续
Start inference。

## 7. 2026-08-31 Volcano 全链路推理验收

### 7.1 宿主机占用与人工隔离探针

最初复核确认 A3 chip 0 上的两个进程属于实际运行的 Docker/SGLang 服务，不是
僵尸进程；其中调度进程持续占用 CPU，HBM 约 30.5 GiB。受控探针曾将
`Ascend910-0,Ascend910-1` 写入 DeviceInfo ConfigMap 的
`ManuallySeparateNPU`，但下一次 Ascend Device Plugin 上报周期自动将该字段恢复
为空，且隔离信息没有传播到 ClusterInfo。由此确认：直接编辑该字段不能作为宿主机
Docker 任务的可靠 Volcano 预留机制。探针未创建任何 NPU Pod，证据保存在
`server-00:/home/admin/qwen38-volcano-isolation-probe-7vHF4X`。

随后宿主机 Docker/SGLang 任务由其责任方退出。部署前同时通过 Kubernetes Pod
annotation 和 A3 `npu-smi info` 确认 0–15 全部无运行进程，才开启 Running window。

### 7.2 Running 请求、门禁和自动同步

- Running 请求：Gitea PR #25，head
  `a6eb1ea667750c6e28933e17a38eb603fa50ec8a`，start ID
  `start-20260831-full-acceptance-01`。
- PipelineRun `model-platform-config-validation-qgwbn` 全部成功；容量门禁记录
  `safe_devices=0..15`、`claimed_devices=`、`npuperworker=2`，Running PR 自动合并。
- Argo 自动同步 merge commit
  `c5ab6fa3101608a2f57d33fc360206172cf430fd`；XR 收敛为
  `Running / workerReplicas=1 / Synced=True / Ready=True`。
- 生产证据目录：
  `server-00:/home/admin/qwen38-full-acceptance-OrKXfa`。

### 7.3 Volcano、模型加载和真实请求

停止态遗留的 CPU-only RayCluster 仍被 KubeRay 当作 pending cluster，RayService
generation 6 没有自动把旧 RayCluster 从 worker 0 更新为 worker 1。按既有受控处理
方式，仅删除 `model-serving/qwen38-27b-ks9n9`，KubeRay 随即依据当前 Running
RayService 重建同名 RayCluster：

- Volcano PodGroup `Running`，minMember/running 为 2/2；
- head 与 worker 均绑定 `a3-server-00`；
- worker 请求 2 个 Ascend910，最终 `Ascend910`/`AscendReal` 均为
  `Ascend910-14,Ascend910-15`；
- 主模型 eager safetensors 10/10、两 TP rank 和 FULL_DECODE_ONLY graph capture
  完成；
- Ray Serve Application `RUNNING`，LLMDeployment 与 LLMRouter 均 `HEALTHY`；
- 两次 `/v1/chat/completions` 返回 HTTP 200，第二次实际输出“测试成功”。

### 7.4 Stop 与最终基线

Running window 在推理成功后立即关闭。Gitea main commit
`3e4d1f93844e42c37e09ef23dbb7c17059b16ae3` 将同一请求恢复为
Stopped/worker 0；main PipelineRun `model-platform-config-validation-zlrz7`
成功，Argo 无人工 Sync 自动更新到该 revision，XR 恢复
Stopped/Synced/Ready。

KubeRay 在缩容方向同样保留旧 worker 1 RayCluster，因此再次只删除该 Qwen
RayCluster，使 operator 按停止态模板重建 CPU-only head。最终 worker 不存在，A3
`npu-smi` 0–15 全部无运行进程，Backstage 状态 API 返回
`Stopped / Synced=True / Ready=True`，Running window 为 false。

### 7.5 验收结论与自动化缺口

Volcano/MindX 动态选卡、Ray/vLLM 模型加载和真实 HTTP 推理均已通过；原拓扑阻塞在
`module-a3-16` selector 下未再出现。当前仍不能标记为“完全无人值守”，因为
Stopped↔Running 时 KubeRay v1.6.0 没有把已存在的 pending RayCluster 随
RayService workerReplicas 更新，启动和停止各需要一次受控删除当前 Qwen
RayCluster以触发重建。后续应把该重建动作收敛到专用控制器或经审查的自动化任务，
并增加调度后 `AscendReal` 冲突检查与自动 Stop；不得依赖人工 kubectl 作为长期流程。
