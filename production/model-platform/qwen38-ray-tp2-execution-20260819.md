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
