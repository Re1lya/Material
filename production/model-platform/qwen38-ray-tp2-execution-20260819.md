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
请求切回 Running。不得直接手工创建 Ray worker，也不得触碰物理 0、1 上的既有任务。
