# Qwen3.8-27B W8A8：Ray TP2/DP1 可复用部署与容量验证方案

状态：已完成 Profile、XRD、Composition、Tekton allow-list 和 Backstage 目录
契约的本地修改；尚未同步 Argo，也没有创建 PVC、缓存 Job、RayService、Ray
worker 或任何 NPU 负载。下面的“执行阶段”只有在用户确认后才开始。

## 1. 先确认 chip 的含义

在当前 `gpu-server-00` 的 Kubernetes 资源模型中，
`huawei.com/Ascend910: 1` 表示一个可分配的 Ascend chip/device 单元。这是
调度语义，等价于 CUDA 集群里常说的一张可分配 GPU；它不是把两个 chip
误认为一张卡，也不是一个完整的物理服务器。因而本次 TP=2 要求一个 Ray
worker Pod 获得两个这样的设备单元。

这只能确认“资源计数和调度单位”的含义，不能仅靠 Git 文件确认两个物理
chip 的拓扑、链路或健康状态。启动前的只读 preflight 必须确认：节点仍是
`gpu-server-00`、有至少两个空闲 `huawei.com/Ascend910`、device-plugin
分配的可见设备可以组成 TP=2，并且不会重用其他程序的设备。Git 不写死物理
chip ID，也不手工覆盖 `ASCEND_RT_VISIBLE_DEVICES`；设备插件负责把实际分配
结果注入 Pod，Ray 只使用这组已分配设备。

## 2. 本次唯一验证 Profile

目录：
`gitops/repository/environments/production/catalog/qwen38-w8a8-ray-ascend-910b3-tp2-v1.yaml`

| 层级 | 参数 | 值 | 说明 |
|---|---|---:|---|
| 模型 | ModelVersion | `qwen3.8-27b-w8a8` | Artifact Keeper 中的不可变 W8A8 制品 |
| 运行时 | workload | `RayService` | 不是 `apps/v1 Deployment` |
| 并行 | TP | 2 | 两个 chip/device 单元共同承载一个副本 |
| 并行 | DP | 1 | 只启动一个模型副本，不额外复制权重 |
| 并行 | PP | 1 | 本次单节点 TP，不做流水线并行 |
| 上下文 | `max_model_len` | 32768 | 保持 32K 不变 |
| 调度 | `max_num_seqs` | 64 | 引擎允许的序列上限；不是承诺 64 个完整 32K 请求同时驻留 |
| 调度 | Ray `max_ongoing_requests` | 64 | Ray Serve 入口并发接纳上限 |
| 批处理 | `max_num_batched_tokens` | 8192 | 每轮批处理 token 预算，不等于实测吞吐 tok/s |
| 显存 | `gpu_memory_utilization` | 0.90 | vLLM 可使用的设备显存比例 |
| KV | Prefix Cache | 开启 | 重复前缀请求用于验证命中收益 |
| 解码 | MTP | 3 token | `qwen3_5_mtp`，`enforce_eager=true` |
| 编译 | CUDAGraph | `FULL_DECODE_ONLY` | 沿用已成功 Docker 记录的模式 |
| 资源 | worker NPU | 2 | Pod requests/limits 与 Ray 自定义资源一致 |
| 位置 | nodeSelector | `gpu-server-00/arm64/910B3` | 只允许目标节点 |
| 状态 | 初始 replicas | 0 | 缓存完成前不占用 NPU；批准后才改为 1 |

参数位于 `runtime.serveConfigV2` 的 Ray Serve LLM `engine_kwargs`，由
Crossplane 原样传给 RayService。Ray Serve LLM 的配置文件字段与 Python
`LLMConfig` 一一对应，`engine_kwargs` 透传 vLLM 引擎参数；这是把 Docker
参数变成 GitOps 声明式参数的关键。参见 [Ray Serve LLM configuration]
(https://docs.ray.io/en/master/serve/llm/user-guides/configuration.html)。

## 3. Docker、普通 Deployment 与 RayService 的差别

| 项目 | A3 Docker 成功记录 | 普通 Kubernetes Deployment | 本次 RayService 链路 |
|---|---|---|---|
| 入口 | 人工 `docker run` | Deployment YAML | ModelDeployment XR |
| 参数 | 命令行 flags/env | 容器 args/env | RuntimeProfile 的 `serveConfigV2` + Composition |
| 设备 | 手工映射 `/dev/davinci*` | Pod 申请设备但通常只有一个进程 | K8s 申请 2 个 chip，Ray placement group 再做 TP gang 调度 |
| 生命周期 | Docker restart | Deployment/ReplicaSet | Argo → Crossplane → KubeRay → Ray Serve |
| TP/DP | vLLM 进程直接读取 flags | 需要自写 entrypoint/调度逻辑 | `tensor_parallel_size=2`、`data_parallel_size=1` 由 Ray Serve LLM 传给引擎 |
| 调度能力 | 机器级，不能感知集群资源 | K8s Pod 级，不能管理引擎 actor | K8s 负责 Pod 资源，Ray 负责 engine actor/placement group |
| 扩缩与复用 | 需重新写命令 | 需重新写 Deployment | 复用同一 XRD/Profile/Composition，仅替换 ModelVersion/Profile |
| 回滚 | 停容器/换命令 | 改 Deployment | 回退 Gitea desired state 或 Profile，Argo 手工同步 |

本次不是把 Docker 命令塞进 `command`。Docker 的 `--tensor-parallel-size`、
`--max-model-len`、Prefix Cache、MTP 等变成 `engine_kwargs`；Docker 的两设备
映射变成 Kubernetes resource request + Ray placement bundles。这样 Ray
才真正参与调度，而不是在 Deployment 里运行一个“看起来像 Ray”的普通进程。

## 4. 完整链路与数据流

```text
ModelScope revision
  -> CPU-only importer
  -> Artifact Keeper model-artifacts（W8A8 manifest + 文件校验和）
  -> Gitea ModelVersion + RuntimeProfile + ModelDeployment
  -> Tekton schema/digest/profile/参数校验
  -> Argo CD 手工 Sync ModelDeployment XR
  -> Crossplane Composition
  -> provider-kubernetes Object
  -> model-serving PVC + cache Job + stopped RayService + Service
  -> cache READY 后，变更 desiredState=Running，再次 Argo Sync
  -> KubeRay RayCluster/head/worker
  -> worker 申请 2 个 Ascend chip/device
  -> Ray placement group 两个 Ascend910 bundle（STRICT_PACK）
  -> Ray Serve LLM -> vLLM-Ascend TP=2/DP=1
  -> Service -> OpenAI-compatible API -> 测试客户端/监控
```

模型大文件只走 ModelScope → Artifact Keeper → 缓存 PVC → worker；Git、Tekton、
Argo、Crossplane 只传小型元数据和期望状态，不携带权重。Argo CD 只管理
`ModelDeployment` XR 的 Git 期望状态，Crossplane Composition 才负责声明
PVC、缓存 Job、RayService、Service 等组合对象，KubeRay 再把 RayService 展开
为 RayCluster 和 Pod。没有 `apps/v1 Deployment` 作为本次测试路径。

## 5. 已完成的控制面改动

本地已经完成以下可审计契约，均不会触发集群操作：

1. 新增 `qwen38-w8a8-ray-ascend-910b3-tp2-v1` RuntimeProfile，固定镜像、
   模型路径、Ray 版本、TP2/DP1、32K 和全部引擎参数。
2. ModelVersion compatibility、XRD、CI JSON Schema、Backstage Gitea allow-list
   和 Scaffolder 参数枚举加入新 Profile。
3. Composition 将 worker 的 `huawei.com/Ascend910` 资源同步为 Ray
   `rayStartParams.resources`，并设置 `RAY_EXPERIMENTAL_NOSET_ASCEND_RT_VISIBLE_DEVICES=1`，
   不手动指定物理设备号。
4. Tekton 校验器对新 Profile 做严格检查：Profile 引用、RayService 类型、
   两个 chip 资源、`build_openai_app`、placement bundles、TP/DP、上下文、
   Prefix Cache、MTP、`FULL_DECODE_ONLY` 和显存比例必须与目录一致。
5. 增加不含秘密的 TP2 模板和本方案文档；现有 8-chip Profile 和已同步的
   Stopped XR 保持不变。

镜像必须在启动前通过 CPU-only 预检确认包含
`ray.serve.llm:build_openai_app`，且 vLLM-Ascend 版本接受 Docker 记录中的
MTP/编译参数。若 import 或参数不兼容，应先修正镜像/Profile，不能静默改成
普通 Deployment，也不能在 NPU 上试错。

## 6. 用户确认后的执行顺序

### 6.1 只读 preflight（不创建 Pod、不申请 NPU）

在 `server-00` 使用受控 `sudo k3s kubectl` 检查：

- `gpu-server-00` 的标签、架构、910B3 资源和当前 allocatable/allocated 差值；
- KubeRay、Crossplane Provider、ProviderConfig、RuntimeProfile/Composition
  CRD 的版本和健康状态；
- 目标 namespace 中是否已有同名 PVC/Job/RayService/Service；
- Artifact Keeper 镜像/模型 digest 可读，缓存 StorageClass 与 PVC 绑定策略；
- Ray runtime image 内仅执行 `python -c 'import ray.serve.llm'` 等 CPU-only
  入口检查，不启动 vLLM、不加载权重。

若两个 chip 不空闲、物理拓扑不适配、镜像入口缺失或目标对象冲突，停止在
preflight，不触碰正在运行的程序。

### 6.2 停止态发布与缓存门控

创建一个新的唯一 ModelDeployment 名称，选择 TP2 Profile，保持
`desiredState: Stopped`、`workerReplicas: 0`，经 Gitea PR → Tekton → 人工
Argo Sync。此阶段期望只有 PVC、缓存 Job、Stopped RayService/Service 等控制
对象，worker 必须为 0；缓存 Job 下载 Artifact Keeper 制品、校验 manifest
和文件 SHA256、原子写入 `READY`。缓存期间不申请 NPU。

### 6.3 运行态与 Ray 调度验证

缓存 `READY` 后提交第二个最小变更，将同一 XR 的 `desiredState` 改为 `Running`
并把 worker replicas 改为 1，再由人工 Argo Sync。依次确认：

1. RayService Ready，RayCluster head/worker 均由 KubeRay 创建；
2. worker Pod 只在 `gpu-server-00`，requests/limits 各为 2；
3. Pod 的 device-plugin 可见设备恰好为两个，未占用其他进程设备；
4. Ray 节点资源含两个 `huawei.com/Ascend910`，placement group 为
   `STRICT_PACK` 两 bundle；
5. vLLM 启动日志显示 TP=2、DP=1、32K、Prefix Cache、MTP=3、
   `FULL_DECODE_ONLY` 和 0.90；
6. `/health`、模型列表和最小 `/v1/chat/completions` 返回成功。

## 7. 32K 容量和吞吐测试

`max_num_batched_tokens=8192` 是调度批次上限，不是预先保证的 8192
tokens/s。实测必须同时记录请求级延迟、输入/输出 token 速率和设备状态。

### 7.1 固定配置

- 不改变 `max_model_len=32768`、TP=2、DP=1、Prefix Cache、MTP=3、
  `FULL_DECODE_ONLY`、显存比例 0.90。
- 预热 1 个短请求，再用约 30K–31K input tokens + 固定短 output 做满上下文
  压力；另做短输入/长输出吞吐场景，避免把两类结果混成一个数字。
- 客户端并发阶梯：1、2、4、8、16、32、64。每档先预热，再稳定采样，
  出现错误率、超时、OOM 或 p99 持续恶化就停止升档，不主动制造 OOM。
- Prefix Cache 单独做相同前缀重复请求与随机前缀对照；否则无法解释缓存收益。

### 7.2 每档记录

| 类别 | 指标 |
|---|---|
| 正确性 | HTTP 成功率、错误分类、输出校验、服务重启次数 |
| 延迟 | TTFT、TPOT、端到端 p50/p95/p99、排队时间 |
| 吞吐 | requests/s、input tok/s、output tok/s、总 tok/s |
| 引擎 | active/running/waiting requests、KV cache 使用率、prefix-cache hit/miss、MTP 接受率（若日志提供） |
| 设备 | 每个 chip 的 HBM、利用率、温度/健康、Ray actor/placement group 状态 |
| 资源 | Pod/worker UID、节点、镜像 digest、模型 manifest digest、测试时间和客户端版本 |

### 7.3 “极限”定义

报告中的极限并发不是配置里的 64，而是“最后一个满足验收条件的并发档位”
（例如连续多个采样窗口成功率达标、p99 在预算内、无 OOM/重启、KV/HBM 未
越界）。如果 64 只是排队上限而稳定驻留能力更低，报告必须分别写出：

```text
offered concurrency = 64
last stable concurrency = 实测值
max_num_batched_tokens = 8192
measured output throughput = 实测 tok/s
```

已有 Docker 记录在 32K 下显示每个 TP rank 的 KV cache 约 583,624 tokens、
理论最大并发约 17.81x（且当时使用 max-num-seqs=16、显存比例 0.85）；这只是
容量基线，不替代本次 Ray/0.90 配置的实测结果。

## 8. 验收、回滚与边界

验收条件是：同一条 ModelDeployment XR 经过缓存门控后能由 KubeRay 创建 Ray
worker，Ray placement group 真实占用两个 chip，Ray Serve LLM 加载模型并能
提供 API，且测试记录可关联到 immutable model/image digest。失败时只将 XR
回退为 `Stopped`、恢复 worker=0 并手工 Argo Sync；不删除 Artifact Keeper
制品，不触碰其他 namespace、其他 Ray 对象或正在运行的 NPU 程序。

本轮先验证一 worker/TP2/DP1 的完整链路，不做多副本、自动扩缩容、跨节点
PP、超 32K 上下文和新模型导入。通过后可复用同一 XRD、Composition、Provider
权限、缓存门控和测试脚本，只新增经过评审的 ModelVersion/RuntimeProfile。
