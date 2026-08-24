# Qwen3.8 A3 Ray 2.48 runtime 构建与发布记录

日期：2026-08-20  
范围：补齐 Ray Serve LLM 依赖、离线构建并发布运行时镜像；不创建 Pod、
RayService 或 NPU 请求。

## 版本基线

保留已经由厂商镜像验证的 Ascend 软件栈，只补 Ray 2.48 LLM extra 缺失项：

| 组件 | 固定版本 |
|---|---|
| 架构 | `linux/arm64` |
| Python | `3.12.13` |
| Ray | `2.48.0` |
| PyArrow | `20.0.0` |
| vLLM | `0.23.0+empty` |
| KubeRay | `1.6.0` |

没有升级或替换基础镜像中的 CANN、torch、torch-npu、vLLM-Ascend。构建定义、
顶层依赖锁和双阶段校验脚本位于 `runtime/qwen38-ray/`。

## 离线依赖供应链

jumper 使用其现有 HTTP/HTTPS 代理下载 CPython 3.12、Linux ARM64 wheel；A3
不访问公网。共传输 43 个 wheel 和 `SHA256SUMS`，A3 校验为 43/43。关键 wheel：

```text
pyarrow-20.0.0-cp312-cp312-manylinux_2_17_aarch64.manylinux2014_aarch64.whl
sha256:4ba3cf4182828be7a896cbd232aa8dd6a31bd1f9e32776cc3796c012855e1199
```

Docker build 使用 `--network=none`、`--no-index` 和本地 wheelhouse。wheel 二进制
不进入 Git；Git 只保存依赖锁与 wheel 摘要。

## 验证结果

1. 构建门禁校验架构、Python/Ray/PyArrow/vLLM 版本及全部新增模块，返回
   `qwen38_ray_runtime_build=PASS`。
2. 完整导入门禁只读挂载 `/usr/local/Ascend/driver`，不传入 `/dev/davinci*`，
   `ray.serve.llm` 和 vLLM-Ascend 导入成功，返回
   `qwen38_ray_runtime_runtime=PASS`。
3. Ray head 不申请 NPU，因此单独验证 `VLLM_PLUGINS=""`：在不挂载 driver、
   不暴露设备的容器中完整 `ray.serve.llm` 导入成功。Composition 据此只对 head
   禁用平台插件；worker 仍加载 Ascend 插件。
4. 基础镜像和派生镜像的 `pip check` 均为 12 条相同的厂商既有告警；派生镜像
   没有新增依赖冲突。

## Artifact Keeper 发布

发布使用已有 Qwen publisher service account 的一次性 token：限定
`container-images` 仓库、1 天有效，发布完成后立即撤销。Artifact Keeper 1.6.0
的 OCI v2 上传要求裸 `write`，但 token API 不允许签发裸 `write`，且
`write:artifacts` 不满足裸 `write`；因此本次 token 使用 `*`，同时由单仓库绑定、
短有效期和用后撤销收敛权限。首次权限不足 token 也已撤销。管理员身份只用于
签发/撤销，未用于上传。

发布工具为官方 `regctl v0.11.5` Linux/ARM64，下载摘要
`sha256:c4cf231e74cda685f1599f3d866b02b03c572e54b79ec8b062f32070b0ba4587`。
未修改或重启 A3 Docker daemon。最终不可变引用：

```text
110.120.0.3:30670/container-images/qwen38-ray-runtime@sha256:16995677e10be892e92d164c7a6c8902f37ccb9c2c2d0d79180664006b55d0fb
```

远端 manifest 为 Docker schema 2、`linux/arm64`。A3 保留本地 Docker 镜像
`qwen38-ray-runtime:ray2.48.0-v1`；18 GiB 临时 tar、A3/本地明文 token 文件和
regctl 登录均已清理。

## 发布时尚未执行的门禁

- 镜像发布完成这一时点尚未创建或同步运行态 XR、PVC、缓存 Job、RayService、
  Service 或 Pod；后续实际进展以 `qwen38-ray-tp2-execution-20260819.md` 为准。
- TP2 Profile 在发布时已改用上述 digest、Ray 2.48，并把目标节点设为
  `a3-server-00`/`Ascend910`。
- 真正把 XR 切换到运行态前，必须同时检查 Kubernetes NPU requests 和 A3
  `npu-smi` 物理进程。若 16 个 chip 全部有业务进程，或不足两个可用 chip，
  立即停止，不创建 NPU worker。

## 运行时拉取权限补充

模型缓存 Job 首次访问私有 `model-artifacts` 仓库时返回 404。该 404 是
Artifact Keeper 对无仓库权限请求的掩码，不代表制品不存在。为运行时身份
`svc-qwen38-model-runtime` 增加了仅限 `model-artifacts` 的 `read` 权限；token
仍只含 `read:artifacts`，没有写入和管理权限。修正后 manifest GET 返回 200，
26/26 文件完成 SHA256 校验，运行时 token 不写入 Git。

## 2026-08-24：Ray Serve protobuf 兼容修订 v2

首次实际创建 RayService 时，RayCluster head/worker 已正常加入集群，但 Serve 在模型
Actor 创建前失败：`FieldDescriptor` 不再包含 `label`。运行镜像实测为 Ray 2.48.0、
protobuf 7.35.1；Ray 2.48 的配置反序列化仍使用该旧 API，因此错误发生在 Serve 控制
面，尚未进入模型加载或 DevMM 阶段。

修订镜像不改 CANN、torch、torch-npu、vLLM、vLLM-Ascend 或模型，只锁定以下互相
兼容的控制面依赖：

| 包 | 版本 |
|---|---|
| protobuf | `5.29.6` |
| proto-plus | `1.26.1` |
| googleapis-common-protos | `1.70.0` |
| google-api-core | `2.25.2` |

`5.29.6` 同时满足当前 vLLM 的 `protobuf>=5.29.6` 约束。断网构建门禁通过，
`FieldDescriptor.label` 实测恢复；只读挂载主机 driver、但不暴露 NPU 的完整
`ray.serve.llm`/vLLM-Ascend 导入门禁也通过。新不可变引用为：

```text
110.120.0.3:30670/container-images/qwen38-ray-runtime@sha256:5deedaef878bfada687238124fa8d7add52f153882b16c987e0b7694b48d7751
```

发布使用既有 Qwen publisher service account 新签发的单仓库、一天有效一次性 token；
发布与 digest 校验后立即撤销。Git 中只保存锁文件和 wheel SHA256，不保存 wheel 或
凭据。按用户要求，新 digest 仅写入待同步的 Profile/ModelDeployment 和 smoke manifest，
没有同步运行态 XR，也没有启动新版模型。

## 2026-08-24：Ray 2.48 / 厂商 vLLM 0.23 运行兼容修订 v3

v2 完成模型加载后，实际请求依次暴露 Ray Serve LLM adapter 与厂商 vLLM 0.23 的
接口漂移：`VLLM_USE_V1`、`make_async`、chat renderer、`AsyncEngineArgs`、同步
tokenizer/model config、`SamplingParams.best_of` 及请求队列指标字段均不兼容。
这些问题属于 Python 控制/适配层，不是驱动、HCCL、TP 或模型权重故障。

`runtime/qwen38-ray/apply_ray_vllm_compat.py` 将本次实测补丁固化为构建期精确替换；
若 Ray 源文件发生漂移，构建会直接失败。补丁不升级或替换 vLLM、vLLM-Ascend、
torch-npu、CANN 和驱动。v3 离线构建及不暴露 NPU 的 runtime import 门禁均通过：

```text
qwen38_ray_runtime_build=PASS
qwen38_ray_runtime_runtime=PASS
```

Artifact Keeper 不可变引用为：

```text
110.120.0.3:30670/container-images/qwen38-ray-runtime@sha256:cdb5b3b44a1192b2d1268941033b004d5e9cf371621a0920f6d0afe62484e942
```

manifest 为 `linux/arm64`。发布仍使用已有 publisher service account 的一次性
`*` token，管理员只负责签发和撤销；上传、摘要检查完成后 token 已撤销，regctl
登录、明文 token 和 18GiB 临时 tar 均已清理。v1、v2、v3 tag 均保留且共享层；
v2→v3 实际新增 5 个压缩层、约 57.6MiB，并非复制一份 18GiB 镜像。

发布后只读容量检查：Artifact Keeper 制品目录物理占用约 102GiB；
`model-artifacts` 为 63.9/430GiB，`container-images` 为 61.5/50GiB。后者已超过
配置配额但 OCI 路径本次没有硬拒绝写入；继续发布新镜像前应先评审扩容或带引用检查
的版本保留策略，本文不授权删除旧 tag。
