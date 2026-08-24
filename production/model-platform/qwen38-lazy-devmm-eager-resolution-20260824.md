# Qwen3.8-27B-W8A8：lazy Safetensors/DevMM 启动故障复盘与 eager 修复

> 日期：2026-08-24  
> 主机：`a3-server-00`（Atlas A3）  
> 模型：`/home/models/Qwen3.8-27B-w8a8`（10 个 Safetensors 分片，29.92 GiB）  
> 镜像：`quay.io/ascend/vllm-ascend:qwen3.8-a3`  
> 镜像 ID：`sha256:41dab489874e4983324d9d960a6c57f8bd45ebb5172a3b7672bd64461f9d96b7`

本文记录一次可重复的模型加载故障、诊断证据、A/B 验证以及最终可用的加载策略。
它补充而不替代既有的 [Docker 部署记录](qwen38-docker-a3-deployment-record-20260818.md)。

## 1. 结论

稳定可用的加载配置是：

```bash
--safetensors-load-strategy eager
```

其余推理参数保持不变，使用 vLLM 的默认模型 loader（即**不**传入
`--model-loader-extra-config`）。在前 8 个 chip 上，四个 `TP=2`、`DP=1`
实例均完成权重加载、图编译、KV Cache 初始化，并且四个 `/health` 都返回
HTTP 200。

故障发生在默认的 `lazy` Safetensors 加载路径。该路径在当前 A3 的
Ascend DevMM/驱动运行环境中，对模型分片 mmap 页面执行页面固定（pin）时失败；
它不是 HBM 容量、主机 RAM 容量、HCCL 建链或 TP=2 拓扑不足。

根因的证据边界如下：

- **已直接证实**：lazy 路径卡在权重分片 `0/10`，驱动对两个 vLLM Worker
  记录了 `Get_user_pages_fast fail` 与 `ret=-14`；故障虚拟地址属于第一个
  Safetensors 分片的 mmap 区间。
- **工程判断（高置信）**：问题位于 lazy mmap 到 DevMM 页面固定之间的兼容性
  路径；eager 通过切换权重读取路径绕过该问题。
- **尚未证明**：具体是 Ascend 驱动、DevMM 内核模块还是对应版本的 vLLM-Ascend
  适配层存在缺陷。若需要修复底层问题，应向驱动/vLLM-Ascend 支持方提供第 6 节
  的归档。

## 2. 原始失败配置

失败实例使用的是默认模型 loader，未指定 Safetensors 加载策略：

```text
load_format=auto
safetensors_load_strategy=默认 lazy
model_loader_extra_config=未设置（默认 loader，未启用多线程）
TP=2, DP=1
```

注意：原命令中的 MTP 配置含有：

```json
{"method":"qwen3_5_mtp","num_speculative_tokens":3,"enforce_eager":true}
```

其中的 `enforce_eager` 是 **MTP speculative decoding** 的执行选项，和
`--safetensors-load-strategy eager` 完全不同；它不会改变权重文件的加载策略。

启动日志在 EXT4 文件系统上明确说明没有自动预取：

```text
Auto-prefetch is disabled because the filesystem (EXT4) is not a recognized
network FS (NFS/Lustre). If you want to force prefetching, start vLLM with
--safetensors-load-strategy=prefetch.
```

随后停在：

```text
Loading safetensors checkpoint shards: 0% Completed | 0/10
```

超过数分钟后仍不推进，API 端口也没有开始监听。

## 3. 关键驱动证据

受控复现时，宿主机 Worker PID 为 `670605` 与 `670736`。内核日志在
`2026-08-24 10:15:41 +08:00` 记录：

```text
[ascend] [devmm] [ERROR] [devmm_pin_user_pages_fast 124]
<VLLM::Worker_TP:670605,670605> Get_user_pages_fast fail.
(va=0xfffc8c19e2e8; expected_page_num=1; real_got_page_num=0)

[ascend] [devmm] [ERROR] [devmm_get_non_svm_addr_pa_list 1293]
<VLLM::Worker_TP:670605,670605> Get user pages fail.
(ret=-14; va=0xfffc8c19e2e8; size=0x200; num=1)

[ascend] [devmm] [ERROR] [devmm_make_host_pa_node_list 1417]
<VLLM::Worker_TP:670736,670736> Get pa list failed.
(pin_flg=3; va=fffc8c19e2e8)
```

将该地址与两个 Worker 的 `/proc/<pid>/maps` 对照，结果一致：

```text
fffc80800000-fffd5a227000 rw-p ...
/models/Qwen3.8-27B-w8a8/quant_model_weights-00001-of-00010.safetensors
```

即：DevMM 无法固定第一个权重分片 mmap 区域中的页面，因而模型加载无法从
`0/10` 前进。

## 4. 排除项与 A/B 验证

### 4.1 不是容量不足

失败时的证据：

| 项目 | 观测值 |
|---|---:|
| 主机可用 RAM | 约 1975 GiB |
| 模型 checkpoint | 29.92 GiB |
| 每个 TP Worker 的 HBM 占用（卡死时） | 约 15,483 MiB |
| 每个 chip 的 HBM 总量 | 65,536 MiB |
| Docker 内存限制 | 未设置（`0`） |
| Docker `OOMKilled` | `false` |

因此失败发生得远早于 KV Cache 或完整运行期显存分配，也没有本次时间窗口的
Linux OOM/HBM OOM 记录。

### 4.2 不只是冷页缓存问题

没有使用 `echo 3 > /proc/sys/vm/drop_caches`，因为这是全局操作，会影响
其他服务。

| 组别 | 唯一变量 | 结果 |
|---|---|---|
| A | 默认 lazy 路径 | 卡在 `0/10`，并出现 DevMM `ret=-14` |
| B | 启动前用 buffered `dd` 顺序读取全部 10 个分片；`fincore` 显示每个分片 `RES` 已接近/达到 `SIZE` | 仍卡在 `0/10`，健康检查失败 |

B 组说明“分片是否在 Linux 页缓存中”不是充分条件。B 组未记录新的同 PID
DevMM 错误，但服务仍不能启动；因此不能将预热作为稳定的部署绕过方案。

## 5. 为什么 eager 可以修复

`lazy` 和 `eager` 的核心差异是权重分片的读取时机与内存访问路径：

| 策略 | 权重访问方式 | 本次表现 |
|---|---|---|
| `lazy`（默认） | 使用 Safetensors 的按需/mmap 读取路径；后续页面需经 DevMM 固定并提交给 NPU | 在首个分片页面固定处失败，停在 `0/10` |
| `eager` | 启动阶段主动完整读取各个 Safetensors 分片，再进行权重装载 | 完成 `10/10`，成功启动 API |

`eager` 不会修复或升级底层驱动；它改变了 vLLM 权重读取与准备路径，从而避开了
本机上会触发 `Get_user_pages_fast` 失败的 lazy mmap 页面固定流程。这是本次
成功的直接原因。

实际日志：

```text
Loading safetensors checkpoint shards (eager): 100% Completed | 10/10
Loading weights took 7.75 seconds
Loading model weights took 16.2796 GB
```

因此应将 `eager + 默认 loader` 视为此主机/镜像组合的部署基线，而不应继续把
默认 lazy 路径用于生产启动。

### 5.1 为什么不组合 eager 与多线程 loader

这不是本次修复的组成部分。vLLM `DefaultModelLoader` 对多线程加载器的约束是：
多线程 Safetensors loader 只实现默认 lazy 策略，不能与 `eager` 或 `prefetch`
组合。故本次的正确组合是：

```text
safetensors-load-strategy = eager
model loader = 默认单线程 loader
```

参考：[vLLM `DefaultModelLoader` 源码](https://github.com/vllm-project/vllm/blob/main/vllm/model_executor/model_loader/default_loader.py)。

## 6. 修复后的验证结果

前 8 个物理 chip 已成功部署四个独立 API 实例：

| 宿主机 chip | 容器 | 端口 | 状态 |
|---|---|---:|---|
| 0, 1 | `qwen38-eager-front-tp2` | 8000 | `/health` 200，chat 请求 200 |
| 2, 3 | `qwen38-eager-front-tp2-1` | 8001 | `/health` 200 |
| 4, 5 | `qwen38-eager-front-tp2-2` | 8002 | `/health` 200 |
| 6, 7 | `qwen38-eager-front-tp2-3` | 8003 | `/health` 200 |

每个实例参数一致：`TP=2`、`DP=1`、`max-num-seqs=16`、
`max-model-len=32768`、`gpu-memory-utilization=0.85`，并额外指定：

```bash
--safetensors-load-strategy eager
```

启动完成后，每个 chip 的 vLLM Worker HBM 使用量约为 52.4 GiB；单个 TP rank
可用 KV Cache 为 33.51 GiB，日志给出的 32K 理论最大并发约为 17.81，故
`max-num-seqs=16` 仍处于合理范围。

## 7. 后续运行规范

1. 所有新的 Qwen3.8-27B-W8A8 vLLM 服务都显式加上
   `--safetensors-load-strategy eager`，不要依赖默认 lazy 行为。
2. 不要把 `eager/prefetch` 与 `enable_multithread_load` 组合；该组合不受
   vLLM 默认 loader 支持。
3. 保留现有 Docker 设备映射、只读模型挂载和 `TP=2` 配置；本次没有证据表明
   它们是故障来源。
4. 若以后需要排查底层问题，复用受控采集方式，不执行全局 `drop_caches`、NPU
   reset、驱动重载或节点重启。
5. 若变更镜像、CANN、驱动或 vLLM-Ascend 版本，重新验证 lazy/eager 行为；
   不能假定 lazy 会自动恢复稳定。

### RayService 路径复核

同日使用 RayService 在 A3 物理 chip 8/9 复核了相同模型。默认 `auto` 在 EXT4 上
明确禁用自动 prefetch，表现为 lazy/mmap 并停在 `0/10`；显式 `prefetch` 也没有越过
分片加载。只有把 `engine_kwargs.safetensors_load_strategy` 固定为 `eager` 后，主模型
和 MTP draft 权重均完成 10/10，Ray Serve 应用进入 `RUNNING`，OpenAI chat 请求最终
返回 HTTP 200。因此 eager 不是 Docker 专属临时参数，而是当前 Docker 与 RayService
两条路径共同的运行基线。

## 8. A3 证据归档

完整的容器日志、驱动日志、Worker 映射与调用现场保存在 A3：

```text
/home/models/qwen38-diagnostics/controlled-20260824T101027+0800.tar.gz
SHA256: 813a364b9e44ab97ed0bd7926a48a3cbae0ccd0962d539866aa0deb7b0c02e15

/home/models/qwen38-diagnostics/prewarm-20260824T104750+0800.tar.gz
SHA256: 3cb7c6c7556df1b0bdfba1c5c6a52652df6350e9c4e3c1a2bf880ff962c0662d
```
