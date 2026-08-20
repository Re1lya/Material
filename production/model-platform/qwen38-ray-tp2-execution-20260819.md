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
