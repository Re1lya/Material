# Qwen3.8-27B-W8A8：Atlas A3 Docker 部署记录

> 记录日期：2026-08-18
> 目标主机：`a3-server-00`
> 部署方式：Docker `run`，四个独立的 vLLM API 服务
> 状态：已启动并完成健康检查、实际推理验证

## 1. 部署结论

本次在 Atlas A3 后 8 个物理 chip 上部署了 4 个相互独立的 Qwen3.8
服务。每个服务使用 2 个 chip 做 `TP=2`，`DP=1`；每个服务限制最多 16
个调度中的序列，最大上下文长度为 32K。

```text
后 8 个 chip
├── chip 8, 9   -> qwen38-tp2-0 -> http://A3-IP:8000
├── chip 10, 11 -> qwen38-tp2-1 -> http://A3-IP:8001
├── chip 12, 13 -> qwen38-tp2-2 -> http://A3-IP:8002
└── chip 14, 15 -> qwen38-tp2-3 -> http://A3-IP:8003
```

前 8 个 chip（物理 chip 0–7）上的原有进程未修改。

## 2. 主机文件和镜像

### 模型

| 项目 | 值 |
|---|---|
| 模型 | `Qwen3.8-27B-w8a8` |
| 宿主机目录 | `/home/models/Qwen3.8-27B-w8a8` |
| 容器内目录 | `/models/Qwen3.8-27B-w8a8` |
| 挂载方式 | 只读（`:ro`） |
| 权重规模 | 约 29.92 GiB，10 个 Safetensors 分片 |
| 量化 | Ascend W8A8 |

### vLLM-Ascend 镜像

| 项目 | 值 |
|---|---|
| Docker 镜像 | `quay.io/ascend/vllm-ascend:qwen3.8-a3` |
| 镜像归档 | `/home/models/vllm-images/vllm-ascend-qwen3.8-a3.tar` |
| vLLM | `0.23.0` |
| torch-npu | `2.10.0.post4` |
| CANN | `9.1.0` |
| 架构 | ARM64 |

镜像加载命令：

```bash
sudo docker load \
  -i /home/models/vllm-images/vllm-ascend-qwen3.8-a3.tar
```

## 3. 服务和设备映射

vLLM 在 A3 上按 chip 级设备工作。每个容器只映射一对宿主机
`/dev/davinci*`；容器内通过 `ASCEND_RT_VISIBLE_DEVICES=0,1` 将这两个设备
作为本容器的逻辑设备 0、1。

| 容器 | 宿主机设备 | 端口 | 并行配置 |
|---|---|---:|---|
| `qwen38-tp2-0` | `/dev/davinci8,9` | 8000 | TP=2, DP=1 |
| `qwen38-tp2-1` | `/dev/davinci10,11` | 8001 | TP=2, DP=1 |
| `qwen38-tp2-2` | `/dev/davinci12,13` | 8002 | TP=2, DP=1 |
| `qwen38-tp2-3` | `/dev/davinci14,15` | 8003 | TP=2, DP=1 |

容器名称、端口和设备是绑定关系，不应让两个容器复用同一组 chip 或端口。

## 4. 实际 Docker 参数

下面是四个容器共用的 `docker run` 模板；`SERVICE`、`PORT`、`CHIP_A` 和
`CHIP_B` 按上一节的映射表替换。

```bash
sudo docker run -d \
  --name "${SERVICE}" \
  --restart unless-stopped \
  --net=host \
  --shm-size=1g \
  --device="/dev/davinci${CHIP_A}" \
  --device="/dev/davinci${CHIP_B}" \
  --device=/dev/davinci_manager \
  --device=/dev/devmm_svm \
  --device=/dev/hisi_hdc \
  -e ASCEND_RT_VISIBLE_DEVICES=0,1 \
  -e PYTORCH_NPU_ALLOC_CONF=expandable_segments:True \
  -e HCCL_BUFFSIZE=512 \
  -e OMP_PROC_BIND=false \
  -e OMP_NUM_THREADS=1 \
  -v /usr/local/dcmi:/usr/local/dcmi:ro \
  -v /usr/local/Ascend/driver/tools/hccn_tool:/usr/local/Ascend/driver/tools/hccn_tool:ro \
  -v /usr/local/bin/npu-smi:/usr/local/bin/npu-smi:ro \
  -v /usr/local/Ascend/driver/lib64/:/usr/local/Ascend/driver/lib64/:ro \
  -v /usr/local/Ascend/driver/version.info:/usr/local/Ascend/driver/version.info:ro \
  -v /etc/ascend_install.info:/etc/ascend_install.info:ro \
  -v /home/models/Qwen3.8-27B-w8a8:/models/Qwen3.8-27B-w8a8:ro \
  quay.io/ascend/vllm-ascend:qwen3.8-a3 \
  vllm serve /models/Qwen3.8-27B-w8a8 \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --served-model-name qwen3.8 \
    --tensor-parallel-size 2 \
    --data-parallel-size 1 \
    --quantization ascend \
    --max-num-seqs 16 \
    --max-model-len 32768 \
    --max-num-batched-tokens 4096 \
    --gpu-memory-utilization 0.85 \
    --enable-prefix-caching \
    --trust-remote-code \
    --speculative-config \
      '{"method":"qwen3_5_mtp","num_speculative_tokens":3,"enforce_eager":true}' \
    --compilation-config \
      '{"cudagraph_mode":"FULL_DECODE_ONLY"}'
```

### 4.1 推理参数说明

| 参数 | 当前值 | 作用 |
|---|---:|---|
| `--tensor-parallel-size` | 2 | 每个服务横跨 2 个 chip |
| `--data-parallel-size` | 1 | 每个容器只运行 1 个模型副本 |
| `--max-num-seqs` | 16 | 单个服务的最大调度序列数 |
| `--max-model-len` | 32768 | 单请求最大上下文长度 |
| `--max-num-batched-tokens` | 4096 | 单轮批处理 token 上限，当前取保守值 |
| `--gpu-memory-utilization` | 0.85 | vLLM 可使用的 NPU 显存比例 |
| Prefix Cache | 开启 | 复用相同前缀的 KV Cache |
| MTP | 3 tokens | 开启 Qwen3.5 MTP speculative decoding |
| CUDAGraph | `FULL_DECODE_ONLY` | 使用官方 A3 示例的 decode 图模式 |

## 5. 暴露方式

当前版本使用 Docker `--net=host`，因此实际入口是 A3 主机端口：

```text
http://A3-IP:8000/v1/chat/completions
http://A3-IP:8001/v1/chat/completions
http://A3-IP:8002/v1/chat/completions
http://A3-IP:8003/v1/chat/completions
```

当前不是 Kubernetes `NodePort`，也没有四个服务的统一负载均衡入口。原因是
`a3-server-00` 当前是 k3s-agent，本机没有可用的 Kubernetes API Server；后续
应在集群控制面配置 Service/NodePort，或增加网关做统一入口和轮询分发。

## 6. 验证结果

### 服务验证

四个端口的 `/health` 均返回 HTTP 200；四个端口各发送一次最小
`/v1/chat/completions` 请求，均返回 HTTP 200。

```bash
for port in 8000 8001 8002 8003; do
  curl -sS -m 5 -o /dev/null -w "${port}: %{http_code}\n" \
    "http://127.0.0.1:${port}/health"
done
```

### NPU 验证

`npu-smi info` 观察到：

- NPU 4–7 的 chip 0、1（物理 chip 8–15）均有 `VLLMWorker_TP` 进程。
- 每个物理 chip 的 vLLM worker 进程显存约 52.5 GB。
- NPU 0–3 仍由原有 `python3.11` 进程占用，未被本次 Docker 部署接管。

### KV Cache 基线

每个 TP rank 的启动日志显示：

```text
Available KV cache memory: 33.51 GiB
GPU KV cache size: 583,624 tokens
Maximum concurrency for 32,768 tokens per request: 17.81x
```

因此当前 `max-num-seqs=16` 在 32K 配置下是合理的吞吐基线，但它表示调度器
上限，不代表任何时刻都能同时驻留 16 个完整 32K 请求。

## 7. 常用检查和操作

查看四个容器：

```bash
sudo docker ps -a --filter 'name=qwen38-tp2'
```

查看健康状态：

```bash
for port in 8000 8001 8002 8003; do
  curl -sS -m 5 -o /dev/null -w "${port}: %{http_code}\n" \
    "http://127.0.0.1:${port}/health"
done
```

查看设备占用：

```bash
sudo npu-smi info
```

只重启本次创建的服务：

```bash
sudo docker restart \
  qwen38-tp2-0 qwen38-tp2-1 qwen38-tp2-2 qwen38-tp2-3
```

不要对前 8 个 chip 上的既有容器或进程执行停止、删除、重启操作。

## 8. 后续建议

1. 保留当前 `16 并发 + 32K` 作为合成语料吞吐基线，先做 C1/C4/C8/C16 压测。
2. 64K 应单独建立测试档位，建议先使用 `max-num-seqs=8`；按当前 KV Cache
   规模估算，满 64K 请求的理论驻留并发约为 8–9 个。
3. 稳定后再比较 `max-num-batched-tokens=8192/16384`，并记录 TTFT、TPOT、
   output tok/s、HBM 和失败率。
4. MTP 建议做 on/off A/B 测试；当前部署基线为 MTP 开启。
5. 正式对外服务前，在集群控制面补齐 NodePort 或网关，并决定是否把四个
   后端聚合成一个 OpenAI Compatible 入口。

## 9. 官方参考

- [vLLM-Ascend Qwen3.8-27B 官方文档](https://github.com/vllm-project/vllm-ascend/blob/main/docs/source/tutorials/models/Qwen3.8-27B.md)
- 镜像：`quay.io/ascend/vllm-ascend:qwen3.8-a3`
