# 生产集群监控与 NPU 容量盘点

> 盘点时间：2026-08-19 04:43 UTC
>
> 本记录只来自 `server-00` 的 Kubernetes/Prometheus 只读查询。没有重启、扩缩容、
> 修改 exporter、修改告警、创建工作负载或向任何 NPU 提交请求。

## 1. 当前监控组件

生产 K3s 的 `monitoring` 命名空间由 kube-prometheus-stack 和 OpenTelemetry 组件
组成，当前观测到的 Pod 均为 `Running`：

| 组件 | 作用 | 当前入口/状态 |
| --- | --- | --- |
| Prometheus | 抓取 Kubernetes、Node Exporter 和 NPU 指标 | NodePort `110.120.0.3:30090`，Pod `2/2 Running` |
| Grafana | 查询和展示 Prometheus 数据 | NodePort `110.120.0.3:32000`，Pod `3/3 Running` |
| Alertmanager | 告警接收/路由 | Pod `2/2 Running` |
| kube-state-metrics | Kubernetes 对象状态 | `1/1 Running` |
| Node Exporter | Linux 节点 CPU、内存、磁盘等主机指标 | 10 个节点均有 DaemonSet Pod |
| OpenTelemetry Collector | Prometheus/OTel 采集辅助链路 | Collector 与 Target Allocator 均正常 |

另外，`kube-system/metrics-server` 只适合 Kubernetes CPU/内存用量，不提供 NPU
利用率，不能替代 NPU exporter。

## 2. NPU exporter 覆盖范围

`npu-exporter` 命名空间中的 DaemonSet 当前为 `9/9/9`，Service 为
`npu-exporter-svc:8082`。`monitoring/npu-exporter-sm` 以 30 秒间隔抓取
`/metrics`，并将 exporter Pod 所在节点写入 `node_name` 标签。Prometheus 当前
发现的 9 个 target 均为 `up=1`：

| 节点 | 地址 | 硬件标签/架构 | exporter |
| --- | --- | --- | --- |
| `a3-server-00` | `110.123.0.3` | Ascend A3，ARM64 | 已抓取 |
| `gpu-server-00` | `110.129.0.20` | 910B3，ARM64 | 已抓取 |
| `gpu-server-01` | `110.129.0.22` | 910B3，ARM64 | 已抓取 |
| `gpu-server-02` | `110.129.0.16` | 910B3，ARM64 | 已抓取 |
| `gpu-server-03` | `110.129.0.18` | 910B3，ARM64 | 已抓取 |
| `gpu-server-05` | `110.129.0.5` | 910B3，ARM64 | 已抓取 |
| `gpu-server-06` | `110.129.0.7` | 910B3，ARM64 | 已抓取 |
| `gpu-server-07` | `110.129.0.12` | 910B3，ARM64 | 已抓取 |
| `gpu-server-08` | `110.129.0.14` | 910B3，ARM64 | 已抓取 |

当前 Kubernetes 节点清单中没有 `a2-server-*`、`A2` 或 `110.122.*` 节点。这里的
`gpu-server-*` 是 910B3 池，不应在文档或调度规则中误称为 A2。若 A2 是集群外的
独立主机，它不会因为安装了集群内 exporter 就自动进入这套监控；需要在该主机部署
兼容 exporter，并通过 Prometheus 静态 target、ServiceMonitor 或 remote_write
显式接入。

## 3. NPU 指标与只读快照

exporter 暴露了卡数、整体/AI Core/Cube/Vector 利用率、HBM 总量与使用量、进程数、
温度、电源、链路和错误计数等指标。以下是 Prometheus 在盘点时的聚合值；HBM 数值
沿用 exporter 原始单位，页面展示时应明确单位，不要直接当作 GiB：

| 节点 | NPU 数 | `avg(npu_chip_info_overall_utilization)` | `max(...)` | 进程数 | HBM used / total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `a3-server-00` | 16 | 45.5 | 100 | 8 | 471572 / 1048576 |
| `gpu-server-00` | 8 | 0 | 0 | 0 | 27241 / 524288 |
| `gpu-server-01` | 8 | 0 | 0 | 0 | 27226 / 524288 |
| `gpu-server-02` | 8 | 0 | 0 | 0 | 27234 / 524288 |
| `gpu-server-03` | 8 | 0 | 0 | 0 | 27251 / 524288 |
| `gpu-server-05` | 8 | 0 | 0 | 0 | 27244 / 524288 |
| `gpu-server-06` | 8 | 0 | 0 | 0 | 27248 / 524288 |
| `gpu-server-07` | 8 | 0 | 0 | 0 | 27253 / 524288 |
| `gpu-server-08` | 8 | 0 | 0 | 0 | 27248 / 524288 |

本快照说明：A3 在盘点时不是空闲节点；`gpu-server-00` 等 910B3 节点在该时刻
没有 exporter 识别到的 NPU 进程且整体利用率为 0，可作为后续人工容量复核的候选，
但不能据此自动启动模型。

推荐的最小查询示例：

```promql
up{job="npu-exporter-svc",node_name="gpu-server-00"}
avg by (node_name) (npu_chip_info_overall_utilization)
sum by (node_name) (npu_chip_info_process_info_num)
sum by (node_name) (npu_chip_info_hbm_used_memory)
max by (node_name) (machine_npu_nums)
```

## 4. “空闲”判定边界

当前监控可以回答“设备此刻的观测用量”，不能单独回答“现在提交一个 RayService
一定能调度成功”。上线前仍需同时核对：

1. Prometheus `up` 和 exporter 时间新鲜度；
2. `overall_utilization`、进程数、HBM 使用量和硬件错误/链路状态；
3. Kubernetes 节点 `Ready`、`Allocatable` 与现有 Pod 的 `requests`，尤其是
   `huawei.com/Ascend910` 的已分配量；
4. 节点磁盘、内存、网络和现有业务窗口；
5. 人工批准的目标节点、卡组和回滚方案。

当前没有发现针对 NPU 的 `PrometheusRule` 告警规则。因此 Grafana/Prometheus 能够
查询 NPU，但不会自动产生“空闲窗口”或容量预约，也不会替代 Crossplane/Argo 的
发布审批。后续若要平台化，可先增加只读 recording rule/告警（exporter 掉线、
利用率持续阈值、HBM 阈值、ECC/链路错误），再由发布门禁读取这些结果；这一步不应
直接授予自动部署权限。

## 5. 与 ModelDeployment/Backstage 的使用方式

Recipe 页面展示 ModelVersion/RuntimeProfile 声明和 `model-serving` 控制面只读状态；
Prometheus/Grafana 仍是 NPU 实时指标入口，页面目前不直接代理 Prometheus，也不调用
Prometheus 写接口，更不以“空闲”作为自动发车条件。当前安全链路仍为：

```text
Backstage recipe
  -> Gitea stopped ModelDeployment PR
  -> Tekton 校验
  -> 人工合并
  -> Argo CD 手工 Sync
  -> Crossplane Composition
  -> 经过容量复核后，单独批准缓存/Running RayService
```

因此本次盘点不会改变 `gpu-server-00` 的任何状态；它只为后续人工容量评审提供
Prometheus 查询和可审计快照。

## 6. 2026-08-19 07:03 UTC 物理设备复核

随后对 `a3-server-00`（`110.123.0.3`）和 `gpu-server-00`
（`110.129.0.20`）进行了只读 SSH 复核。结果显示，Kubernetes 的
`huawei.com/Ascend910` requests 在两个节点均为 0，但这两个节点都有绕过
Kubernetes 资源记账的 Docker/宿主机任务；因此不能把 `kubectl describe node`
中的 0 当作物理设备空闲。

| 节点 | 物理复核 | 当前结论 |
| --- | --- | --- |
| `a3-server-00` | `npu-smi` 显示 NPU 0–3 无运行进程；NPU 4–7 有 `VLLMWorker_TP`，每个芯片约 55GB HBM 使用，AICore 约 78–82%。宿主机上已有 4 个 Qwen3.8 vLLM 端口（8000–8003，TP=2） | 部分空闲（至少 NPU 0–3 未见业务进程），但 A3 的 8 个 NPU ID 下有 16 个 chip 行，Kubernetes 资源与 chip 拓扑尚未完成映射，不能直接作为本次目标 |
| `gpu-server-00` | `npu-smi` 显示 0–7 均有 `python3.10` 进程，每张约 10.4GB HBM；进程属于 `/verl` Docker 容器，映射 `/dev/davinci0`–`/dev/davinci7`，正在运行 8 卡 `torchrun` 训练 | 无空闲设备，不能部署本次 Ray TP2 |

这说明当前 NPU exporter/Prometheus 只读快照与 Docker 直连任务存在可见性缺口：
exporter 能报告指标，但不能阻止未向 Kubernetes 申请资源的 Docker 进程占用设备。
后续容量门禁必须同时读取 exporter、`npu-smi` 和 Docker/宿主机进程；在目标节点
释放并重新确认前，不得提交 RayService 或其他 NPU 工作负载。本次复核没有停止、
重启或修改任何现有程序。
