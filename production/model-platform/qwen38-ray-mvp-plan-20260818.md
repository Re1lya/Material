# Qwen3.8-27B（ModelScope）+ Ray 可复用生产首发方案

> TP=2/DP=1 的当前首发参数、Docker→Ray 映射、chip 语义和 32K 容量测试以
> `qwen38-ray-tp2-deployment-and-capacity-plan-20260819.md` 及
> `qwen38-w8a8-ray-ascend-910b3-tp2-v1.yaml` 为准；本文保留基础设施与
> 数据流背景。本文中的 8-NPU 首发数值是历史基线，不是本次执行目标。

> 状态：控制面/导入器第一阶段源码已准备，尚未执行生产下载、量化或部署；目标
> 是 `Qwen/Qwen3.8-27B` 的 BF16 源制品经隔离的 msModelSlim 任务生成 W8A8
> 正式制品。该模型和 ModelSlim 适配尚未通过实际预检，未确认前不得用 Qwen3.6
> 或其他模型替代
>
> 日期：2026-08-18
>
> 目标：在 `gpu-server-00` 上用一次小范围、可回收的验证，确认模型、
> ARM64/Ascend 910B3、现有 KubeRay、运行时和 API 全部可用；通过后直接
> 将同一份已验证配置纳入平台 GitOps。

这份文档是本次 Qwen3.8 任务的执行基线。原有 Qwen3.6/A3 方案仍保留作
历史参考，但不作为本次模型、硬件或运行时的默认值。

本轮已完成并应用控制面基础：provider ServiceAccount/`model-serving` 限定
Role+RoleBinding、无 NPU 的 DeploymentRuntimeConfig、Qwen3.8 XRD 和 Composition；
这些基础资源目前由受控 foundation 清单直接落地，尚未纳入生产 Argo Application。
CPU-only ModelScope importer、Artifact Keeper 读回缓存的 manifest sidecar 和
Tekton catalog/XR 校验规则仍是未执行的发布材料。Provider 包 digest、实际模型
revision、Artifact Keeper publisher/reader 凭据、镜像 digest 和 node-local
StorageClass 证据齐全前不会安装 Provider/ProviderConfig 或同步正式
ModelDeployment。

这里的“冒烟”不是一次性 POC：冒烟阶段直接渲染最终的 ModelVersion、缓存
契约、RayService 模板、镜像 digest、Service、NetworkPolicy、RBAC、资源配额、
监控和 Argo CD Application；只通过环境 overlay、desiredState 和一次性校验
开关控制是否发车。通过后只更新 Git 中的期望状态，不复制或重写运行实现。

## 1. 只保留一条链路

```text
ModelScope
  -> CPU-only 下载/校验 BF16 源制品
  -> Artifact Keeper（BF16 源制品，不可变）
  -> 隔离的 ModelSlim W8A8 量化任务（不在 gpu-server-00 执行）
  -> Artifact Keeper（W8A8 正式运行制品，不可变）
  -> Gitea GitOps PR
  -> Tekton 校验
  -> Argo CD 手工 Sync ModelDeployment XR
  -> Crossplane Provider + Composition
  -> 现有 KubeRay RayService
  -> gpu-server-00 的 8 张 Ascend NPU
  -> 最小 OpenAI 兼容请求
```

约束：

- ModelScope 是外部源；运行时不在启动时访问公网，推理只读 Artifact Keeper
  校验后的节点缓存。
- 使用生产中已有的 KubeRay Operator v1.6.0；不安装第二套 Operator，不改动
  `ds`、`ray-demo` 或其他现有 Ray 对象。
- 目标节点为 `gpu-server-00`（ARM64、8 × `huawei.com/Ascend910`、910B3）。
  首次 Ray worker 只允许 1 个副本并申请 8 张卡，head 只申请 CPU。
- 首次只验证文本请求和 16K/32K 上下文；不把 262K/1M 上下文、视觉视频、
  多副本、高可用和自动扩缩容放进冒烟测试。
- 测试和正式发布共用长期的 `model-serving` namespace；如需隔离，只使用同一组
  Kustomize base 的 canary overlay，不创建以后会删除的 POC namespace，不按模型
  或版本重复创建 namespace。执行前先只读确认该 namespace 没有冲突工作负载；若
  已被其他系统占用，只创建一个长期的 `model-serving-prod`，之后仍不按模型拆分。

## 1.1 部署链路与数据流

这条链路里有两种完全不同的数据：模型大文件走数据面，模型版本和部署意图走
控制面。大文件不会经过 Git、Tekton、Argo CD 或 Crossplane。

```text
数据面（模型文件）

ModelScope BF16 revision
    │  importer：CPU-only；staging；文件 SHA256
    ▼
Artifact Keeper / model-artifacts/qwen3.8-27b/bf16/<revision>
    │  immutable source manifest
    ▼
隔离 ModelSlim quantizer（专用 NPU builder；不触碰 gpu-server-00）
    │  W8A8 config + calibration；输出 manifest
    ▼
Artifact Keeper / model-artifacts/qwen3.8-27b/w8a8/<revision>/<quant-id>
    │  reader token；运行时只读最终 W8A8 制品
    ▼
gpu-server-00 node-local PVC
    │  临时目录 -> 校验 -> 原子 rename -> READY
    ▼
Ray worker（只读挂载缓存）
    │  8 × Ascend910；模型加载到 NPU
    ▼
Ray Serve / vLLM-Ascend API -> Service -> 内部调用方

控制面（元数据和期望状态）

    ModelScope modelId/revision + manifestDigest
    ▼
ModelVersion / ModelRuntimeProfile / ModelDeployment（Gitea）
    ▼
Tekton：精确 commit 校验、digest/架构/字段白名单、状态回写
    ▼
Argo CD：从合并 commit 渲染并 Sync model-serving 中的 ModelDeployment XR
    ▼
    ModelDeployment XR（由 Tekton 从 catalog 生成的不可变 artifact/runtime/cache 字段）
    -> Crossplane Composition -> RayService
    ▼
KubeRay Operator -> RayCluster/Pods
    ▼
Argo/Kubernetes 状态、日志、NPU exporter 指标 -> 运维/Backstage
```

逐步看，第一次发布只需要以下动作：

1. **导入**：ModelScope importer 使用单独的 publisher credential 下载指定
   BF16 revision；它不申请 NPU，下载到 staging，生成 canonical manifest 后上传
   `qwen3.8-27b/bf16/<revision>`。相同 revision/digest 重跑应是 no-op，内容变化
   则拒绝覆盖。此阶段可以在 CPU-only 环境完成。
2. **量化**：隔离的 ModelSlim quantizer 只读取 BF16 源制品和固定校准集，使用
   官方验证过且与目标 Ascend/推理引擎匹配的配置生成 W8A8；输出到新的不可变
   `qwen3.8-27b/w8a8/<revision>/<quant-id>`，上传 manifest 最后作为发布标记。
   量化任务需要 NPU-capable builder，但本阶段不调度、不修改 `gpu-server-00`。
3. **登记**：ModelVersion 的 `artifact` 只指向 W8A8 正式制品，同时记录 BF16
   `inputArtifact`、ModelSlim 版本、配置摘要和校准集摘要；ModelRuntimeProfile
   声明 `quantization=w8a8`、运行镜像、Ray 版本、8 NPU 规格和节点选择器。Git
   只保存这些小型元数据，不保存模型权重。
4. **校验**：Gitea PR 触发 Tekton。Tekton checkout 精确 commit，检查 schema、
   ModelVersion 引用、Artifact Keeper digest、ARM64 镜像 digest、NPU 数量和
   禁止字段；它不下载 30GiB 级模型，也不创建 Ray/NPU 对象。
5. **发布**：PR 合并后，Argo CD 手工 Sync `ModelDeployment` XR。Provider 的
   ServiceAccount/Role/RoleBinding 和 ProviderConfig 先由平台清单预置；Crossplane
   Composition 再创建/管理 `model-serving` 内的 Secret 引用、节点本地 PVC、缓存 Job、
   RayService、Service、NetworkPolicy、Quota 和探针；PVC 使用预先只读确认过的 node-local
   StorageClass。若底层实现需要 cluster-scoped Local PV，则把 PV 作为独立基础设施
   发布单元预置，不能偷偷扩大 Provider 的权限。Argo 只负责提交 XR，Crossplane
   负责组合对象，KubeRay 负责 Ray 调度；三者都不把模型文件放进控制面。
6. **缓存**：缓存 Job 运行在 `gpu-server-00`，只使用 Artifact Keeper reader
   token。它把模型下载到临时目录，核对每个文件和整体 manifestDigest，成功后
   原子切换并写 `READY`。Ray worker 没有 ModelScope token，也没有外网下载权限。
7. **调度与加载**：缓存完成前，Composition 将 RayService 保持为停止状态，
   worker replicas/minReplicas 为 0，不申请 NPU。缓存 `READY` 后，把同一
   `ModelDeployment` 的 `desiredState` 改为 `Running` 并由 Argo 再次 Sync；
   Composition 才把 RayService worker 调到 1。随后 KubeRay 创建 Ray head 和
   worker，worker 以 `nodeSelector=gpu-server-00` 申请 8 张
   `huawei.com/Ascend910`，挂载已 `READY` 的缓存和经验证的 ARM64/Ascend 镜像，
   再由 vLLM-Ascend/Ray Serve 加载模型。
8. **验收**：只做 readiness、健康接口和一次短文本 chat 请求，记录
   `modelRevision/manifestDigest/imageDigest/node/NPU`。不在这一轮做长时间吞吐、
   多副本、超长上下文或视觉能力优化。

导入失败不会产生 Artifact Keeper 正式版本；缓存失败不会产生 `READY`；Ray
调度失败不会改变已有缓存；运行失败只回退 Git desired state。这样每一层都能
单独重试，且不会重新下载或重复占用 NPU。

## 1.2 Argo CD 与 Crossplane 的关系

两者职责不同，不是“二选一的 CD”：

这里的 Kubernetes `Service`（网络入口）和 KubeRay `RayService`（Ray 工作负载
声明）也不是同一个对象。Argo CD 可以同时提交两者；真正把 `RayService` 展开为
RayCluster/Serve worker 的是 KubeRay Operator。

| 组件 | 作用 | 是否直接触发下游发布 |
|---|---|---|
| Argo CD | 读取 Git 合并后的期望状态，创建/更新 Kubernetes 对象，报告 Sync/Health | 是，当前唯一 CD 执行者 |
| Crossplane Provider | 使用受限 ServiceAccount 在 `model-serving` 中创建/观察 Composition 生成的 Kubernetes 对象 | 否；它只执行 Crossplane 的组合结果 |
| Crossplane Composition | 把 `ModelDeployment` XR 翻译成 PVC、缓存 Job、RayService、Service 和策略对象，并持续 reconcile | 否；它由 Argo CD 先把 XR 提交到集群后才工作 |
| KubeRay Operator | 监听 `RayService`，生成 RayCluster、Serve worker 和 Service 状态 | 否；它不读 Git |

本次首发采用的实际链路是：

```text
Gitea -> Tekton -> Argo CD -> ModelDeployment XR
                              -> Crossplane Composition
                              -> Provider-kubernetes Object
                              -> PVC + cache Job + stopped RayService + Service
                              -> cache READY 后 desiredState=Running
                              -> RayService worker=1
                              -> KubeRay -> RayCluster/Pods/NPU
```

当前生产 Crossplane 还没有这条运行链路，因此需要在首次上线前补齐以下一次性
平台能力；这些工作会成为后续模型的复用底座，而不是 Qwen3.8 专用临时逻辑：

1. **Provider 包**：锁定 `provider-kubernetes` 的版本、架构、来源和 digest，
   通过 Artifact Keeper/内部 HTTPS 安装到 `crossplane-system`；Provider Pod
   只调度到 `server-00`，不申请 NPU。
2. **ProviderConfig 与身份**：使用集群内受限 ServiceAccount（或该 Provider
   版本支持的 injected identity），ProviderConfig 只允许访问
   `model-serving`；凭据 Secret 不写入 Git。
3. **最小 RBAC**：Provider ServiceAccount 只允许在目标 namespace 对
   `PersistentVolumeClaim`、`Job`、`Service`、`ConfigMap`、`NetworkPolicy`、
   `ResourceQuota`、`LimitRange` 和 `ray.io/RayService` 执行
   get/list/watch/create/update/patch/delete；对指定的 Artifact Keeper/image-pull
   Secret 最多只读，不允许写 Secret。Provider 自己的 ServiceAccount、Role 和
   RoleBinding 由独立平台清单预置，不由 Composition 动态创建。Provider 不允许
   修改其他 namespace、PV/StorageClass、NPU Device Plugin、节点或现有 Ray 对象。
4. **Composition**：将 `ModelDeployment` 字段映射为
   `kubernetes.crossplane.io/Object`（或锁定 Provider 对应的对象类型），并把
   modelVersion、runtimeProfile、manifestDigest、cache PVC、cache Job、
   RayService、Service 和策略对象的 owner/reference 统一起来。
5. **XRD 契约**：在保留现有 `Stopped/control-plane-only` 兼容行为的前提下，增加
   经过 allow-list 的 Qwen3.8 ModelVersion/RuntimeProfile 引用、`Running` 状态和
   `model-serving` 目标；不开放任意镜像、命令、物理卡号或任意 Kubernetes 字段。
6. **缓存门控**：Composition 初始只产生 PVC、缓存 Job 和 worker=0 的 stopped
   RayService；确认缓存 Job `Complete`/`READY` 后，Git 中将 `desiredState` 改为
   `Running`，Argo 再 Sync，Composition 才把 worker 调到 1，避免 NPU 在下载期间
   被占用。
7. **状态与回滚**：Composition 将 Provider 对象的 readiness、cache Job 失败
   原因、RayService 状态和 API 健康结果映射到 XR conditions；失败只回退 Git 的
   desiredState/revision，不删除 Artifact Keeper 正式制品。

因此这次不是“Argo 绕过 Crossplane”，而是：**Argo 负责 CD，Crossplane 负责
平台资源组合，KubeRay 负责 Ray 工作负载**。Crossplane 的 Provider/RBAC/
Composition 需要先以 control-plane-only 或 stopped XR 验证，确认没有 NPU 分配
后，再打开 `desiredState=Running`。

Crossplane 实施顺序固定为：

```text
P0  provider package + digest + server-00 调度约束
 -> P1 ProviderConfig + model-serving ServiceAccount/Role/RoleBinding
 -> P2 Composition dry-run：只生成 ConfigMap/PVC/stopped RayService
 -> P3 stopped XR：缓存 Job 完成、READY 和 XR conditions 验证
 -> P4 desiredState=Running：Composition 更新 worker=1，KubeRay 申请 8 NPU
 -> P5 health + 最小 chat + Git revision 回滚验证
```

P0-P3 都不申请 NPU；任何 Provider/RBAC/Composition 错误在 P4 之前终止。

## 2. 模型与制品规则

目标 ModelScope ID（必须先实际查验，不能把候选名当成已存在的制品）：

```text
Qwen/Qwen3.8-27B            # BF16 源制品；最终运行制品为 ModelSlim W8A8
```

链接按候选记录保留；截至本轮预检，公开 ModelScope 搜索返回的是
[Qwen3.6-27B-FP8](https://www.modelscope.cn/models/Qwen/Qwen3.6-27B-FP8)，
没有把它静默替换为 Qwen3.8。若 Qwen3.8 仓库是私有、尚未发布或 ID 不同，需由
用户提供确切 `modelId` 和可读 revision 后再执行 importer。

下载前必须通过 ModelScope API/CLI 确认仓库真实存在，并记录不可变 revision、
文件清单、大小和 SHA256。若仓库暂时不可见或 ID 发生变化，测试立即停止；不能
静默改用 Qwen3.6 或社区量化版本。

一次性导入与量化流程：

```text
    ModelScope BF16 revision
  -> modelscope download（CPU-only、staging 目录）
  -> canonical BF16 manifest + manifestDigest
  -> Artifact Keeper qwen3.8-27b/bf16/<revision>
  -> 隔离 ModelSlim（固定 config/calibration）生成 W8A8
  -> canonical W8A8 manifest + manifestDigest
  -> Artifact Keeper qwen3.8-27b/w8a8/<revision>/<quant-id>
  -> 服务端重新读取并复核两份清单
```

Artifact Keeper 是集群内部的正式运行副本，ModelScope 不作为运行时依赖。模型
运行 Secret 仅允许读取对应仓库/路径；ModelScope token（如需要）只注入下载任务，
不得进入 Git、镜像、日志或 Ray Pod。

## 2.1 BF16 源制品与 ModelSlim W8A8 正式制品

本方案不把 BF16 和 W8A8 混写成一种权重格式：BF16 是输入模型精度，W8A8 是
ModelSlim 导出的最终权重/激活量化格式。运行时只挂载 W8A8 目录，BF16 目录只作
可追溯输入和失败重算依据。

ModelSlim 量化必须固定以下元数据，否则不能登记为可部署 ModelVersion：

1. `msModelSlim` 版本和实际 `model_type` 注册名；若 Qwen3.8 不在官方支持矩阵，
   只能进入 `Unsupported`，不能凭 Qwen3.6 的配置直接冒险上线。
2. 与目标推理引擎/910B3 节点匹配的 W8A8 配置摘要；不得用浮动默认配置。
3. 校准数据集摘要和版本；量化输出的文件清单、大小、SHA256、`manifestDigest`。
4. ModelSlim 输出格式必须是目标 MindIE/vLLM-Ascend 镜像能直接读取的格式，不接受
   仅在 CPU/通用 CUDA 运行时可读的 GPTQ、AWQ 或 ONNX 替代物。

量化任务属于制品构建，不属于 RayService Composition：它在独立的 NPU-capable
builder 上运行，写入 Artifact Keeper 后结束；Tekton 只校验摘要和引用，不在 CI
里申请 NPU。若暂时没有隔离 builder，只完成 BF16 导入和控制面准备，不把未经量化
的 BF16 路径伪装成 W8A8 发布。

## 2.2 `gpu-server-00` 的 node-local PV/PVC 是什么

这不是 GPU/NPU 显存，而是节点磁盘上的模型缓存：

| 对象 | 含义 | 本次用途 |
|---|---|---|
| PV（PersistentVolume） | 集群级“这块磁盘空间在哪里、容量多少、绑定哪个节点”的声明 | 代表 `gpu-server-00` 上的一块可保留本地磁盘目录/卷 |
| PVC（PersistentVolumeClaim） | namespace 内工作负载申请这块空间的声明 | `model-serving` 中的 `qwen38-model-cache`，由缓存 Job 写入、Ray worker 只读挂载 |
| node-local StorageClass | 让 PVC 绑定到目标节点本地盘的存储策略 | 通常使用 `WaitForFirstConsumer`，避免 PVC 先绑定到错误节点 |

推荐关系：

```text
gpu-server-00 本地磁盘（例如 /mnt/data 下的专用目录，最终路径需预检）
  -> node-local StorageClass / Local PV（基础设施层预置）
  -> model-serving/qwen38-model-cache PVC（Crossplane Composition 创建）
  -> cache Job：读写 staging/final 目录
  -> Ray worker：同一 PVC 只读挂载
```

它的边界很明确：

- 数据只在 `gpu-server-00`，没有跨节点复制；节点不可用时，Ray 不能依赖这份
  缓存，但可以从 Artifact Keeper 重新构建。
- Artifact Keeper 才是正式模型副本，PVC 只是可重建的加速缓存；PVC 丢失不等于
  模型丢失。
- `Retain` 表示删除 PVC/工作负载时不自动清空底层目录，便于回滚和复用；清理
  需要单独的管理员动作，不能由失败的 Composition 自动删除。
- 缓存容量按实际 manifest 大小加下载 staging 和余量计算，不能直接复用暂停中的
  `ora-desktop-cache` PVC，也不能把缓存写到其他程序的目录。
- Provider/Composition 只负责 namespace 内 PVC；如果使用 cluster-scoped PV，
  PV、StorageClass 和底层目录由独立基础设施发布单元管理，避免给 Provider
  cluster-wide 删除权限。

## 2.3 Namespace 复用策略

namespace 不按模型、revision 或 RayService 创建。推荐分层如下：

| 层 | namespace | 生命周期 | 说明 |
|---|---|---|---|
| 制品 | `artifact-keeper` | 平台级、长期 | 模型和镜像仓库 |
| CD/组合 | `argocd`、`crossplane-system`、`ray-mangement` | 平台级、长期 | Argo、Crossplane、KubeRay 控制器 |
| 模型运行 | `model-serving` | 平台级、长期 | ModelDeployment、PVC、缓存 Job、RayService、Service |
| 项目隔离（未来） | 每个团队/项目一个 | 按项目 | 只有确实需要租户隔离时才增加，不按模型增加 |

首次执行先只读检查现有 `model-serving` 是否为空或仅有平台允许的基础对象；若
没有冲突就直接复用，不再创建 `qwen38-serving`。后续新增模型只增加 namespaced
资源和标签，例如：

```text
model-serving/
  ModelDeployment/qwen38-27b
  PVC/model-cache-qwen38-<manifest-short>
  Job/model-cache-qwen38-<manifest-short>
  RayService/qwen38-27b
  Service/qwen38-27b
```

Crossplane Provider 的 Role 只绑定 `model-serving`，ProviderConfig、Argo
AppProject、Quota、NetworkPolicy 和基础 ServiceAccount 也只初始化一次。这样
复用第二个模型时不需要新 namespace、新 Provider 或第二套 KubeRay；只新增新的
ModelVersion、缓存键和 ModelDeployment。若未来需要团队隔离，再为团队复制一套
namespace 基础模板，而不是为每个版本复制 namespace。

namespace 本身由平台 bootstrap/Argo 基础 Application 创建和保护；Crossplane
Composition 不创建、不删除 namespace。这样 Provider 的 namespace-scoped Role
在组合资源前已经存在，也避免删除一个 XR 时连带删除整个运行边界。

## 3. 两个门，不做中间大工程

### 门 0：只读预检

不创建工作负载，只确认：

1. ModelScope 仓库、revision、格式和下载大小。
2. ModelSlim 是否有 Qwen3.8 的已注册 `model_type` 和 W8A8 配置；若没有，记录
   `Unsupported`，不拿 Qwen3.6/Qwen3.5 的配置冒充兼容。
3. 量化 builder 的 CANN/ModelSlim/transformers/vLLM-Ascend 版本、校准集摘要和
   输出格式；仅允许在隔离 builder 做实际量化，不在本轮把任务调度到
   `gpu-server-00`。
4. `gpu-server-00` 的架构、910B3 标签、8 张可分配 NPU、CPU/内存/磁盘余量。
5. NPU Exporter 与 Kubernetes 请求均显示目标卡组空闲；`npu-smi` 不可用时，
   以 exporter 和 device-plugin 数据为准。
6. `gpu-server-00` 已完成 Artifact Keeper 容器运行时 endpoint/认证配置，并用
   一个无 NPU 的 ARM64 测试 Pod 按 digest 成功拉取；当前只读基线显示其他 worker
   尚未完成这一步，因此不能把“server-00 已注册”推断为目标节点已可拉取。
7. Artifact Keeper 的模型运行只读 Secret、节点 HTTP/HTTPS 拉取路径和剩余容量。
8. `gpu-server-00` 上可用的 node-local StorageClass、实际可用容量、PVC
   `WaitForFirstConsumer` 行为和缓存保留策略；不能把暂停中的其他 PVC 当作缓存。
9. Crossplane Provider `Installed/Healthy`、ProviderConfig 引用正确、Provider
   ServiceAccount 在 `model-serving` 的最小权限通过；用无 NPU 的 ConfigMap/
   stopped XR 验证能创建目标对象，并确认无法写其他 namespace 或 Ray/NPU 对象。
10. Composition server-side dry-run/render 通过，能生成 PVC、缓存 Job、stopped
   RayService 和 Service，且没有任何 `huawei.com/Ascend910` 请求。
11. 候选推理镜像、importer、缓存和验收镜像均提供 ARM64/Ascend 版本，并固定到
   digest；未知镜像不得进入测试。

### 门 1：一次兼容性冒烟（使用最终生产形态）

在最终的 `model-serving` 发布单元中运行一次 canary；不创建一套以后会删除的
`qwen38-smoke` 专用模板。若必须隔离测试，仅使用同一组 Kustomize base 的
`smoke` overlay，资源名、标签、Service、权限和运行参数保持一致：

1. **XR/Composition 控制面（零 NPU）**：Argo Sync 一个
   `desiredState=Stopped` 的 `ModelDeployment`；确认 XR `Synced/Ready`，Provider
   只在 `model-serving` 产生 PVC、缓存 Job、stopped RayService 和 Service，且
   Composition 没有生成 NPU 请求。
2. **制品/缓存流程（零 NPU）**：固定到 `gpu-server-00`，先把 ModelScope
   revision 下载到临时目录并逐文件 SHA256 校验，再上传到 Artifact Keeper；随后
   从 Artifact Keeper 读回到最终缓存目录并再次校验，最后原子写入 `READY`。
   这可以实现为两个顺序 Job（ingest、cache）或一个受限的一次性任务，不新增
   Controller。任一步失败都不能覆盖已有有效目录。
3. **RayService**：缓存确认后，只修改同一 Git 发布单元的
   `desiredState=Running` 并由 Argo 再次 Sync；Crossplane 更新 RayService，复用
   现有 KubeRay v1.6.0，head 为 CPU-only，worker 为
   1 副本、8 × `huawei.com/Ascend910`，节点选择器锁定 `gpu-server-00`，
   模型以只读方式挂载。运行时从已校验缓存加载，不在 Pod 内重新下载。
4. **最小请求**：等待 RayService/服务 readiness，调用一次
   `/v1/chat/completions`（文本、短 prompt、关闭或保留 thinking 明确记录），
   同时记录模型 revision、镜像 digest、RayService 状态、NPU 分配和首 token/总耗时。

通过条件：

- Provider `Installed/Healthy`，ProviderConfig 和最小 RBAC 正确；XR 在 stopped
  阶段 `Synced/Ready`，只生成目标 namespace 对象；
- 缓存 `manifestDigest` 与 ModelScope/Artifact Keeper 记录一致，且 Artifact
  Keeper 至少完成一次认证读回；
- Ray head/worker 均 Ready，worker 确实落在 `gpu-server-00` 且只申请 8 张 NPU；
- 模型加载成功，readiness 通过，最小请求返回非空有效结果；
- 全局没有因本次测试产生 Pending Pod，也没有修改其他 namespace 的对象；
- 记录一份可复用的 RayService、缓存、资源和启动参数快照。

失败只做一次分类和有限重试：下载/校验、镜像/架构、驱动/算子、模型加载、API
或资源冲突。未通过前不扩大上下文、不增加副本；失败只把同一发布单元的
`desiredState` 保持为 `Stopped`，不另起一套修补实现。已校验制品和缓存是否保留
由发布策略决定，但两者都必须可被同一份正式配置复用。

## 4. 首次实现就按平台组件交付

不再设计第二套运行方案。门 1 开始就交付以下可复用的正式组件：

1. `ModelVersion`：ModelScope owner/repository/revision、Artifact Keeper 路径、
   文件清单和 `manifestDigest`。
2. `ModelRuntimeProfile`：ARM64/910B3、8 NPU、节点选择器、已验证运行镜像
   digest、只读缓存路径、Ray 启动参数和健康检查。
3. `ModelDeployment`：用户意图、desiredState、模型/运行时引用和发布 revision；
   `RayService` 由 Composition 生成，不由用户直接编辑。
4. **ModelScope importer**：可重复执行、按 revision/digest 幂等、支持断点和
   原子发布的 CPU-only 容器/Job；同一组件用于首次导入和后续模型版本发布。
5. **ModelSlim quantizer release job**：独立的 NPU-capable builder 任务，读取
   Artifact Keeper BF16 源制品和固定校准集，输出带 manifest 的 W8A8 制品；不
   与 RayService 共用运行节点，不由 Composition 创建，也不在 Tekton 校验任务中
   申请 NPU。
6. **Crossplane Provider 基础**：锁定 provider-kubernetes 包、ProviderConfig、
   `model-serving` 最小 ServiceAccount/Role/RoleBinding 和 deny-by-default 的
   namespace 边界；Provider 仅调度在 server-00，不申请 NPU。
7. **ModelDeployment Composition**：生成 PVC、缓存 Job、stopped/Running
   RayService、Service、NetworkPolicy、Quota 和状态条件；以 cache `READY` 和
   desiredState 作为 NPU 发车门控。
8. **节点缓存组件**：只从 Artifact Keeper 读取，按
   `node + modelVersion + manifestDigest` 复用，具有 `READY`、校验失败不覆盖和
   清理保护语义。
9. **RayService release unit**：固定镜像 digest、Ray 版本、8 NPU worker、
   节点选择器、健康探针、Service、日志/指标标签和回滚字段；不把启动参数散落
   在 Job、Backstage 表单或人工 shell 中。
10. **平台交付单元**：namespace、ProviderConfig 引用、Artifact Keeper
   读 Secret 引用、NetworkPolicy、ResourceQuota/LimitRange 和 Argo
   AppProject/Application 均纳入同一 GitOps 路径；节点缓存使用
   `gpu-server-00` 专用 node-local PVC（`Retain`）。底层 hostPath/Local PV
   只作为 StorageClass 的实现细节，不写进 Ray Pod 的临时手工配置。

发布链路保持现有平台边界：

```text
Gitea PR
  -> Tekton：schema、revision、digest、字段白名单和引用校验
  -> 人工评审/合并
  -> Argo CD：手工 Sync，prune=false，selfHeal=false
  -> model-serving 中的 ModelDeployment XR
  -> Crossplane Provider/Composition
  -> PVC + cache Job + RayService + Service/策略对象
```

Tekton 不下载大模型、不申请 NPU、不执行 `kubectl apply`；CI 只验证 Git 内容。
Argo CD 是 CD 执行者，Crossplane 只处理 Argo 提交的 XR，Provider 只操作被
允许的目标 namespace，KubeRay 只处理 Composition 生成的 RayService。这样
Crossplane 是本次首发的正式平台组合层，而不是后续补丁。

## 5. 不可变契约与可复用目录

首次实现至少冻结以下字段；冒烟和正式发布必须共用同一 schema 与校验器：

```yaml
modelVersion:
  source:
    type: modelscope
    modelId: Qwen/Qwen3.8-27B       # BF16 source
    revision: <immutable-modelscope-revision>
  artifact:
    repository: model-artifacts
    path: qwen3.8-27b/w8a8/<revision>/<quant-id>
    manifestDigest: sha256:<canonical-manifest>
  quantization:
    tool: msmodelslim
    sourcePrecision: bf16
    target: w8a8
    configDigest: sha256:<config>
    calibrationDatasetDigest: sha256:<calibration>
    inputArtifact:
      path: qwen3.8-27b/bf16/<revision>
runtimeProfile:
  workload: rayservice
  rayVersion: <tested-ray-version>
  image: <arm64-ascend-image>@sha256:<digest>
  nodeSelector:
    kubernetes.io/hostname: gpu-server-00
  workerReplicas: 1
  npuPerWorker: 8
deployment:
  desiredState: Stopped | Running
  modelVersionRef: <model-version>
  runtimeProfileRef: <runtime-profile>
  compositionRef: qwen38-ray-runtime
```

Crossplane 接收的 `ModelDeployment` 是上面三份 catalog 的受控展开：`artifact`、
`runtime`、`cache` 只由发布生成器填充，且必须分别与 ModelVersion、RuntimeProfile
和节点预检结果一致。初始 XR 的 `desiredState=Stopped` 与
`runtime.workerReplicas=0` 是同一门禁；缓存 `READY` 后才允许在新 commit 中同时改为
`Running` 和 `1`。任何带 `<...>`、浮动 tag、外部 registry 或旧
`ora-desktop-cache-local` 的文件都必须在 Tekton 阶段被拒绝。

建议 GitOps 发布单元固定为：

```text
environments/production/qwen38/
  base/                 # XR、缓存契约、Composition 输入与策略
  overlays/canary/      # 只改变 desiredState/校验开关，不复制模板
  overlays/production/  # 正式期望状态
  catalog/              # ModelVersion + ModelRuntimeProfile
  crossplane/           # ProviderConfig 引用、Composition、Object 模板
```

实际提交到 Gitea 前，`ModelDeployment` XR 由 catalog 生成器填充以下三组
namespaced 字段：`artifact`（ModelScope source revision、最终 W8A8 Artifact Keeper
path 和 manifestDigest）、`runtime`（已验证镜像/Ray/模型路径/worker 数）和 `cache`
（cache image、reader Secret 引用、独立 StorageClass、容量）。它们不是用户自由
输入；Tekton 将其与 ModelVersion/RuntimeProfile 逐项比对。缓存 Job 从 Artifact
Keeper 读取同一路径下最后上传的 `manifest.json`，因此不需要把 manifest 或模型字节
放进 Git/ConfigMap。

同一目录需要通过本地渲染、server-side dry-run、schema/引用校验和回滚渲染；
任何临时 `kubectl edit`、手写启动命令或只存在于聊天记录中的参数都不算实现。

正式发布 PR 前，所有示例中的占位符都必须被实际值替换并由 CI 拒绝残留：

- ModelScope `modelId + revision`、文件清单和 `manifestDigest`；
- Artifact Keeper repository/path、读写 Secret 引用和 importer/cache 镜像 digest；
- ARM64/Ascend runtime 镜像 digest、Ray 版本、启动参数和健康接口；
- `gpu-server-00` node-local StorageClass/PVC 容量、缓存路径、节点 registry pull
  验证证据；
- Argo AppProject/Application 的 repo/path/namespace allow-list 和回滚 revision。

首次实现的 Definition of Done：

- ModelScope importer 对同一 `modelId + revision` 重跑是 no-op；digest 不一致时
  失败而不是覆盖 Artifact Keeper；断点、临时目录、原子发布和失败清理都有自动化
  测试。
- `gpu-server-00` 的 Artifact Keeper ARM64 镜像拉取、只读模型下载和失败重试均已
  单独验收；不能只沿用 `server-00` 的 registry 配置结论。
- 节点缓存只读 Artifact Keeper，缓存键、`READY`、校验失败不覆盖和并发互斥都有
  测试；Ray worker 不拥有 ModelScope 凭据或外网下载权限。
- Provider、ProviderConfig、Composition、`ModelDeployment` XR、缓存 PVC/Job、
  `RayService`、Service、探针、RBAC、NetworkPolicy、Quota、Argo Application
  均由受控 GitOps 发布单元渲染；不存在测试专用 YAML 或人工补丁。
- Tekton 能在 PR 中拒绝错误的 ModelScope revision、manifestDigest、镜像架构、
  节点/NPU 数量和任意命令字段；Argo 只执行合并后的 digest-pinned 内容。
- canary 通过后只改变 `desiredState`/发布 revision 即可完成正式启用；失败时只
  回退 Git revision，不能依赖现场手工改 Pod。

## 6. 最小验收与回滚

上线验收只看六项：

1. Provider `Installed/Healthy`、ProviderConfig/RBAC 正确，XR
   `Synced/Ready` 且只生成目标 namespace 对象；
2. Artifact Keeper 中的 revision 和 manifestDigest 可复核；
3. cache `READY` 存在且只读挂载，缓存阶段没有 NPU 请求；
4. desiredState 切到 Running 后，RayService/worker Ready，节点和 8 NPU 分配正确；
5. `/health`（或运行时实际健康接口）和一次最小 chat 请求成功；
6. Argo `Synced/Healthy`，Git commit、镜像 digest、模型 revision 和 XR conditions
   可追溯。

回滚为单实例停机切换：

```text
Git 将 ModelDeployment desiredState 改回 Stopped 或回退上一条 revision
-> Argo 手工 Sync
-> Crossplane 将 RayService worker 调回 0；缓存和 Artifact Keeper 制品保留
-> 如需切换模型，先完成新的零 NPU cache Job，再切换 desiredState=Running
-> 重新做 health + 最小 chat 验收
```

任何失败只回滚本次 `model-serving` 中该 ModelDeployment 的 GitOps revision，不删除 Artifact Keeper
正式制品，不缩放或删除其他 namespace 的 Ray/NPU 工作负载。

## 7. 明确不做的事情

- 不从 Hugging Face 拉取；本次源固定为 ModelScope。
- 不让 Ray Pod 直接访问 ModelScope 或在 NPU 已分配后下载模型。
- 不部署第二套 KubeRay、Volcano、业务 Operator 或新的控制面数据库；只增加
  一个受限的 `provider-kubernetes` 和本次可复用的 Composition。
- 不把 Crossplane、Tekton、Backstage 改造成模型文件传输通道；Crossplane 只组合
  Kubernetes 对象，模型文件仍由 importer/cache 处理。
- 不在首轮加入多副本、自动扩缩容、灰度、视觉/视频、超长上下文或多租户调度。
- 不触碰已有 `ds`、`ray-demo`、`infra-learning`、训练任务或其他正在运行的程序。

## 8. 相关生产基线

- 现有 KubeRay 与节点只读盘点：`progress-20260810.md` 的 2026-08-18 条目。
- Artifact Keeper 注册和节点拉取边界：`artifact-keeper-registry-registration-20260813.md`。
- 当前 Crossplane runtime-zero 边界：`crossplane/README.md`。
- 原完整平台方案（历史参考）：`../../model-platform-production-integration-plan.md`。
