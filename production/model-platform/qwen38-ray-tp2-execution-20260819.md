# Qwen3.8-27B Ray TP2/DP1 执行记录（2026-08-19）

## 首次生产预检结果

用户确认了在 `gpu-server-00` 上按 RayService、TP=2、DP=1 执行的方案后，
本次只读预检连接到生产 K3s（`server-00`）和目标节点
`gpu-server-00`（`110.129.0.20`）。没有执行 Argo Sync、GitOps 写入、
Crossplane 资源创建、PVC/Job/RayService 创建，也没有修改任何 NPU 进程。

Kubernetes 资源视角显示目标节点 Ready，`huawei.com/Ascend910` capacity/
allocatable 均为 8，Pod requests 分配为 0；但这不等价于物理设备空闲。
节点上的 `npu-smi` 读数显示 0–7 号 910B3 均有活动进程，每张卡约占用
10.4GB HBM，AICore 仍有利用率。

经只读 `ps`/Docker 关联确认，进程属于已有容器：

```text
container: /verl
image:     swr.cn-south-1.myhuaweicloud.com/ascendhub/verl_pt27_25rc3:a2-arm
devices:   /dev/davinci0 ... /dev/davinci7
workload:  torchrun --nproc_per_node 8 --nnodes 8 ... train_node6.sh
```

该容器是现有 8 卡分布式训练程序，不属于本次 Qwen3.8 发布。根据安全边界，
不得停止、重启、抢占或覆盖它；因此本轮执行在物理 NPU preflight 阶段暂停。

## 继续执行门禁

只有在用户确认该训练已完成并明确释放 `gpu-server-00` 后，才重新执行以下
只读检查：

1. `npu-smi` 的 0–7 号设备无非本次工作负载进程，健康状态正常；
2. Kubernetes 仍显示目标节点 Ready，至少两个 `huawei.com/Ascend910` 可用；
3. 目标节点磁盘和本地缓存路径满足约 40Gi PVC；
4. `model-serving` ProviderConfig、Artifact Keeper 只读 Secret 和
   `model-cache-gpu-local` 存储已完成受控配置。

门禁通过后才执行 Stopped XR/缓存阶段，再由同一 XR 切换 Running，创建一个
Ray worker（TP=2、DP=1），最后进行 32K/64 并发容量测试。此前任何阶段都不
申请 NPU，不影响现有 `/verl` 容器或其他节点上的任务。

## 2026-08-20：A3 基础链路和缓存完成

后续目标已切换为 `a3-server-00`，且没有再操作 `gpu-server-00`。Ray 2.48 LLM
依赖已在 jumper 下载、A3 离线构建并发布到 Artifact Keeper；完整版本、摘要、
验证证据和权限收敛记录见 `qwen38-ray-runtime-release-20260820.md`。

已完成以下不占用 NPU 的链路：

1. `model-cache-gpu-local`、A3 本地 PV/PVC 和缓存 Job 创建成功；
2. `model-artifacts` 中的 26/26 文件通过 SHA256 校验，缓存约 30 GiB，
   `model/READY` 已生成；
3. XR、Crossplane Composition、provider-kubernetes 已生成 PVC、缓存 Job、
   NetworkPolicy、RayService、Service 和 ConfigMap；
4. Ray head 以 16 GiB 内存正常启动，不申请或挂载任何 `/dev/davinci*`，
   Ray 2.48 readiness 通过；
5. GitOps 修订均经 Tekton 校验后才进入 Argo CD。

## Ray 2.48 Serve 配置兼容性修正

第一次激活在创建 worker 前即被 Ray Serve 拒绝。运行时错误确认 Ray 2.48 的
`LLMConfig` 不接受较新版本使用的 `placement_group_config`。以镜像内实际
`model_fields` 和源码为准，改为：

```yaml
resources_per_bundle:
  NPU: 1
  GPU: 1
```

TP=2 会由 Ray 自动形成两个 `STRICT_PACK` bundle。`NPU` 是 Ray 自定义资源，
`GPU` 是 vLLM/Ray 2.48 调度兼容别名；Kubernetes worker 仍只申请
`huawei.com/Ascend910: 2`，真实设备只能由 Ascend device-plugin 分配。
Composition 同时把 worker 的 Ray 启动资源改为 `NPU`、设置相同数量的
`num-gpus`，并使用已验证的 `runtimeClassName: ascend`。GitOps 修订
`30f60ea` 已通过 Tekton；部署请求尚未由 Argo CD 同步。

## 09:02 UTC 部署门禁结果：暂停创建 worker

双视角检查结果并不一致：

- Kubernetes 显示 A3 的 `huawei.com/Ascend910` requests/limits 为 0/16；
- `npu-smi` 显示物理 chip 0、1 各占用约 46 GiB HBM，其余 chip 2–15 无进程；
- 进程属于宿主机 Docker 容器 `verl-0.8.0-a3`，不属于 Kubernetes，因而
device-plugin 不知道 chip 0、1 已被占用。

如果此时直接让 Argo CD 同步，device-plugin 可能把本次两颗芯片分配到 0、1，
违反“不影响现有程序”的边界。因此当前只应用了不会创建 NPU Pod 的
Composition 修正，没有同步部署请求，也没有创建 worker。继续条件为：该 Docker
任务释放 0、1，或平台引入能把宿主机外部占用从 K8s allocatable 中隔离的明确
机制；在未确认前不依赖“其余 14 颗物理空闲”直接部署。

## 2026-08-20：A3 TP2 调度链路验证与清理

本次仅在 `a3-server-00` 验证，不操作 `gpu-server-00`。启动前同时检查 Kubernetes
资源请求和宿主机 `npu-smi`；物理 chip 0、1 上原有 Docker 任务保持运行，本次通过
XR 的 `spec.placement.staticDeviceAllocation` 将两个设备限定为
`Ascend910-8,Ascend910-9`。Composition 将该值下发到 Ray worker Pod 的
`huawei.com/Ascend910` annotation，Ray worker 仍以一个 Pod、TP=2、DP=1 申请
`huawei.com/Ascend910: 2`。

为验证 Volcano 之后的四段主链路，曾临时从 KubeRay Operator 参数中移除
`--batch-scheduler=volcano`，只删除并重建本次 Qwen RayCluster，未修改其他
RayService、RayCluster 或业务 Pod。默认调度器下实际观察到：

1. head 和 worker 均绑定到 `a3-server-00`；
2. worker 请求两个 Ascend910，device-plugin 分配的逻辑设备为 8、9；
3. `huawei.com/AscendReal` 和 Ascend configuration annotation 均对应 8、9；
4. device-plugin 日志出现 `correct pod[model-serving:...worker...] annotation success`，
   本次相关时间窗口没有再次出现 `kubelet.sock` 连接错误。

这证明 XR → Crossplane Composition → provider-kubernetes → RayService/KubeRay →
Kubernetes Allocate → Ascend device-plugin 的资源声明、定卡和注解链路可用。临时参数
随后已恢复为 `--batch-scheduler=volcano`，KubeRay Operator 恢复 `1/1 Ready`，没有
留下全局调度策略改动。

worker 在 Allocate 后未能创建 Pod sandbox，事件原文的关键部分为：

```text
unable to get OCI runtime ... no runtime for "ascend" is configured
```

只读核对确认集群已有 `RuntimeClass/ascend`，A3 也安装了
`/usr/local/Ascend/Ascend-Docker-Runtime/ascend-docker-runtime`；但该节点 K3s 使用
`/home/k3s` 作为 data-dir，实际生成的
`/home/k3s/agent/etc/containerd/config.toml` 只注册 `runc`/`crun`，没有 `ascend`
handler，也没有对应的 v3 containerd drop-in。因此模型容器尚未启动，本轮没有进行
模型加载、健康请求、32K 上下文或极限并发/吞吐测试。

### 停止与资源清理

验证结束后执行了以下收敛：

- Gitea `model-platform-config/main` 提交 `0735b3b` 将部署请求改为
  `desiredState: Stopped`、`workerReplicas: 0` 和 stopped effective annotations；
  Tekton 校验成功，Argo CD 已人工同步完整修订
  `0735b3bdae8240e59f24769933cac8aba142273b`，Application 为 `Synced/Healthy`；
- 为防止 KubeRay v1.6.0 的 RayService（该 CRD 没有 `spec.suspend`）在清理期间自动
  重建 head，给 XR 添加 `crossplane.io/paused=true`，然后只删除它所组合的
  `qwen38-27b-rayservice` provider Object；
- RayService、RayCluster、PodGroup 和本次 Ray Pod 已全部删除，A3 节点的
  `huawei.com/Ascend910` requests/limits 回到 `0/0`；物理 8、9 无运行进程；
- 模型缓存 Job/PVC、NetworkPolicy 和 Service 对象继续保留，PVC/制品数据未删除。

恢复部署时须先修复并验证 A3 的 `ascend` containerd runtime handler，再处理 Volcano
调度兼容；随后确认 NPU 双视角空闲，解除 XR 的 pause annotation，并通过同一 GitOps
请求切回 Running。不得直接手工创建 Ray worker，也不得触碰其他既有任务。

## 2026-08-21：Ascend runtime 探针通过

本次只验证此前的 containerd runtime 阻塞，明确使用 `default-scheduler`，没有经过
RayService、PodGroup 或 Volcano。启动前的双视角检查显示：A3 物理 0–15 均没有计算
进程；Kubernetes 已有 `ds/dsv4-tp8-worker-metadata-gs0-ab-59566d84f6-j66cb`
占用 `Ascend910-8` 至 `Ascend910-15`。探针因此固定申请未被 Kubernetes 分配的
`Ascend910-7`，没有接触既有工作负载的 8–15。

第一次使用 Artifact Keeper Qwen 运行时镜像时发生约 2 分 20 秒的重新拉取，超过探针
短时窗口后被清理，不作为最终验收依据。第二次使用 A3 已缓存的 ARM64 Ascend 镜像、
`imagePullPolicy: Never` 创建同名最小探针，关键声明为：

```yaml
schedulerName: default-scheduler
runtimeClassName: ascend
annotations:
  huawei.com/Ascend910: Ascend910-7
resources:
  requests:
    huawei.com/Ascend910: "1"
  limits:
    huawei.com/Ascend910: "1"
```

实际结果为 Pod 绑定 `a3-server-00`，容器 `Created/Started`，最终
`Succeeded/Completed`、退出码 0；`huawei.com/Ascend910` 与
`huawei.com/AscendReal` annotation 都是 `Ascend910-7`。这证明
`RuntimeClass/ascend`、CRI sandbox、容器创建和单 NPU Allocate 链路当前可用，原
`no runtime for "ascend" is configured` 阻塞已经解决。

进一步只读核对 `crictl info`，有效 CRI runtime 中已有：

```text
runtime name: ascend
runtime type: io.containerd.runc.v2
BinaryName: /usr/local/Ascend/Ascend-Docker-Runtime/ascend-docker-runtime
SystemdCgroup: true
```

持久模板 `/home/k3s/agent/etc/containerd/config-v3.toml.tmpl` 与生成配置
`/home/k3s/agent/etc/containerd/config.toml` 均已注册该 handler，修改时间分别为
2026-08-21 16:57:05 和 16:57:21（A3 本地时间）。此前非特权 `grep` 没有输出是因为
目录读取权限不足且 stderr 被丢弃，不能据此判断 handler 缺失。

验收后探针 Pod 已删除。Kubernetes 的 A3 NPU 分配恢复为原有 8 个（仅既有
8–15 工作负载），物理 0–7 均无运行进程。通过 control plane 读取 A3 kubelet 容器
日志时出现过 `10250` TLS handshake timeout，但 Pod 状态、退出码、事件、CRI runtime
和设备 annotation 证据完整；该日志访问问题与 runtime 验证分开记录。Volcano 本轮
没有测试，也没有修复，仍是恢复 RayService 前的独立门禁。

## 2026-08-24：前八张 TP2 启动前置验证与暂停点

本轮按“前八张”语义为 TP=2 worker 分配 chip 0、1，不是申请全部八张。启动前双视角
确认 0–7 无计算进程；测试过程中后八张 8–15 出现既有 `ds` Ray 推理进程，本轮未修改、
停止或占用该任务。

临时绕过 Volcano 后，XR → Crossplane → provider-kubernetes → RayService → KubeRay
成功创建一个 head 和一个两 NPU worker；worker 的实际设备 annotation 为
`Ascend910-0,Ascend910-1`。这次暴露并修复了两个平台定义问题：

1. `rayStartParams.resources` 必须在最终 shell 命令中保留 JSON 外层单引号，否则 Ray
   收到 `{NPU:2}` 并因 JSON 无效退出；Composition 已修正 quoting。
2. worker 与 head 一样需要只读挂载 `/usr/local/Ascend/driver`，否则 Ray 启动时无法
   加载 `libascend_hal.so`；Composition 已补齐 worker hostPath/mount。

随后 Ray Serve 在模型 Actor 启动前因 protobuf 7.35.1 移除了
`FieldDescriptor.label` 而 `DEPLOY_FAILED`，0、1 未出现模型 NPU 进程，也未进入
safetensors/DevMM 阶段。兼容修订镜像已离线构建、完成无 NPU 门禁并发布到 Artifact
Keeper，digest 见运行时发布记录。

根据用户要求，发布后停在正式部署之前：XR 已恢复 `desiredState: Stopped`、
`workerReplicas: 0` 和原静态设备值 8、9，并添加 `crossplane.io/paused=true`；本次
RayService provider Object、RayService、RayCluster 和 Ray Pod 已清理。KubeRay Operator
已恢复 `--batch-scheduler=volcano`，既有 `ds` 与 `ray-demo` head Pod UID、Ready 和
restartCount 均未变化。下一次只有在用户明确确认后，才更新/同步运行态 XR、解除 pause
并再次申请 chip 0、1；启动前仍须重新执行 Kubernetes request 与 `npu-smi` 双视角空闲检查。

停止收敛后的只读复查发现，另一个直接 Docker 容器
`qwen38-eager-front-tp2` 于 11:41:47（A3 本地时间）启动，并在 chip 0、1 各创建一个
`VLLMWorker_TP`。其镜像、容器名和 `--safetensors-load-strategy eager` 命令均不同于
本轮 RayService，启动时间也晚于 Ray 资源清理；因此判定为外部任务，本轮没有停止或
修改它。下一次 Ray 启动不能默认 0、1 可用，必须重新选择空闲设备并取得确认。

## 2026-08-24：后八张中的 chip 8/9 RayService 端到端验证

本轮启动前确认物理 chip 8–15 均无计算进程；0–7 上四个既有 Docker TP2 服务不做
任何操作。XR 仍以一个 worker、`TP=2/DP=1` 申请两颗 NPU，通过已有静态设备约束由
device-plugin 实际分配 `Ascend910-8,Ascend910-9`。临时绕过 Volcano 后，完整链路为：

```text
ModelDeployment XR -> Crossplane Composition -> provider-kubernetes
  -> RayService -> KubeRay RayCluster -> Ascend device-plugin
  -> Ray Serve LLM -> vLLM-Ascend TP2
```

运行参数为 32K 上下文、`max_num_seqs=64`、`max_num_batched_tokens=8192`、
`gpu_memory_utilization=0.90`、Prefix Cache 开启、Qwen3.5 MTP 3 token、
`FULL_DECODE_ONLY`。Safetensors 三组结果：默认 `auto` 在 EXT4 上走 lazy/mmap 并停在
`0/10`；强制 `prefetch` 完成文件预取后仍不能进入分片加载；显式 `eager` 则主模型
10/10 约 10.3 秒、MTP draft 10/10 约 6.7 秒，最终 Ray 应用、LLMDeployment、两份
Router 和 proxy 全部 `HEALTHY/RUNNING`。每个 TP rank 权重约 16.28GiB，运行时每颗
目标 chip HBM 约 55.9GiB，日志估算 32K 理论并发约 19.46；这不是压测结果。

首次 OpenAI chat 请求继续暴露 Ray 2.48 与厂商 vLLM 0.23 的 Python API 漂移。
逐项完成兼容后，最小请求返回 HTTP 200，模型实际生成“Ray部署成功”。适配内容已经
固化进 v3 镜像构建脚本，不能依赖本次容器内热补丁；v3 digest 见运行时发布记录。

验收后 XR 已恢复 `Stopped`、worker=0 并添加 `crossplane.io/paused=true`；组合 Object、
RayService、RayCluster 和本次 Ray Pod 已删除。chip 8–15 均无运行进程，8/9 HBM 回到
约 3GiB 驱动基线。KubeRay Operator 已恢复 `--batch-scheduler=volcano`；既有 `ds`、
`ray-demo` head Pod 的 UID、Ready 和 restartCount 均未变化。此次只完成启动与单请求
端到端门禁，尚未进行 32K 极限并发或吞吐压测。

清理期间 provider 的最终删除存在一次竞态：组合 Object 已不存在后，最后一次 provider
reconcile 又短暂留下一个 worker=0 的 CPU-only Ray head；它未申请 NPU。再次删除该
RayService 并等待 30 秒后，`model-serving` 中 RayService、RayCluster、Pod 均为空，
XR 仍为 `paused=true / Stopped / worker=0`，Volcano 参数保持恢复状态。
