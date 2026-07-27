# 模型服务 POC 实施记录

更新日期：2026-07-27

## 1. 文档目的

本文记录模型服务 POC 的实际实施过程、验证结果、已知限制和后续阶段。

- 目标架构见 `model-serving-poc-design.md`。
- 协作和环境恢复信息见 `AGENTS.md`。
- 本文只把实际执行并验证成功的内容标记为“已完成”。
- 后续每完成一个阶段，更新状态、验证结果和遗留问题。

## 2. 目标与边界

目标是实现以下可演示闭环：

```text
选择模型
-> 提交 Gitea
-> CI 校验
-> Argo CD 同步
-> Crossplane ModelService
-> Helm Release
-> KubeRay RayService
-> 下载并校验模型制品
-> 自动对话验证
-> 固定地址提供服务
```

当前 POC 仅在 `kind-platform-poc-2` 集群中使用 CPU。未安装、申请或挂载
NPU/GPU 资源，也未修改服务器上的 NPU 配置。

## 3. 当前状态

| 能力 | 状态 | 验证结果 |
|---|---|---|
| Artifact Keeper | 已完成 | Backend、Web、PostgreSQL、OpenSearch 健康 |
| 模型制品 | 已完成 | Qwen 和 SmolLM2 已上传并校验 SHA256 |
| KubeRay | 已完成 | Operator 1.6.0 和 CRD 正常 |
| CPU Runtime | 已完成 | Ray、PyTorch、Transformers 离线可用 |
| Ray Serve API | 已完成 | 两个模型均完成真实对话 |
| 模型切换 | 已完成 | Qwen 与 SmolLM2 使用同一服务名切换 |
| Helm Chart | 已完成 | `modelservice` 0.2.0 已发布 |
| 外部路由 | 已完成（临时入口） | Envoy Gateway 和 HTTPRoute 可访问 |
| ModelService CRD | 已完成 | Crossplane `Synced=True`、`Ready=True` |
| 部署后对话验证 | 已完成 | Helm Hook Job 验证成功 |
| Argo CD GitOps 接管 | 已完成 | Gitea 提交可自动更新 ModelService 并切换模型 |
| 模型专用 Tekton CI | 未完成 | 尚未校验 Git 中的模型发布声明 |
| Backstage 自服务入口 | 未完成 | Catalog、PR Action 和模型选择页待接入 |
| 持久外部入口 | 未完成 | 当前 `30081` 依赖 port-forward |

当前运行模型：

```text
ModelService: models/chat-demo
Model:        smollm2-360m-instruct
Chart:        modelservice-0.2.0
Runtime:      poc-cpu-v1
```

## 4. 实施过程

### 4.1 准备模型制品仓库

在 Kind 集群安装 Artifact Keeper：

```text
namespace: artifacts
release:   artifact-keeper
repository: model-artifacts
format:    huggingface
quota:     40GiB
```

POC 保留 Backend、Web、PostgreSQL 和 OpenSearch，关闭 Trivy、
Scanner Adapter、DependencyTrack 等非必要组件。

创建两个机器身份：

- `svc-model-publisher`：上传模型制品。
- `svc-model-runtime`：运行时只读下载。

Runtime Token 存入 `models/artifact-keeper-model-runtime` Secret。文档和 Git
均不保存 Token 明文。

### 4.2 下载、精简和上传模型

在可访问外部模型源的机器下载并锁定两个 revision：

| 模型 | Revision | 压缩包 | SHA256 |
|---|---|---|---|
| Qwen2.5 0.5B Instruct | `7ae557604adf67be50417f59c2c2f167def9a775` | `qwen2.5-0.5b-instruct-7ae55760.tar.gz` | `ebae292a487e413617d1cc7026f5cd5aab76c42f7d05f08644d79c18a1c02a3e` |
| SmolLM2 360M Instruct | `a10cc1512eabd3dde888204e902eca88bddb4951` | `smollm2-360m-instruct-a10cc151.tar.gz` | `f917a7998511a854dc93567d043c6f11ec5db03f76b55b2db973b286bdc0a2fa` |

SmolLM2 初始目录包含约 4.1GiB ONNX 变体。POC 只保留 Transformers
推理所需文件，最终模型目录约 694MiB。

上传大文件时，通过 Web UI 转发端口出现连接重置。改为直接转发 Artifact
Keeper Backend 后，两个制品均上传成功。随后使用集群内临时 Pod 验证：

```text
下载成功
SHA256 校验成功
解压成功
model.safetensors 存在
```

### 4.3 安装 KubeRay 和构建 CPU Runtime

安装 KubeRay Operator 1.6.0，只监听 `models` namespace。确认以下 CRD：

```text
rayclusters.ray.io
rayjobs.ray.io
rayservices.ray.io
```

基础 Ray 镜像不包含 PyTorch 和 Transformers，因此构建 CPU Runtime：

```text
110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
```

验证版本：

```text
Ray          2.52.0
PyTorch      2.5.1+cpu
Transformers 4.48.3
```

服务镜像：

```text
110.120.0.3:8889/platform/model-chat-service:poc-v1
```

服务提供：

```text
GET  /v1/models
POST /v1/chat/completions
```

### 4.4 直接验证 RayService

首次部署 Qwen 时，模型下载和 RayCluster 启动成功，但 Ray Serve 构建任务因
head Pod 内存达到 `1.91Gi / 2Gi` 被 Ray OOM 保护机制终止。

修复：

```text
head request: 2Gi
head limit:   4Gi
```

修复后 Qwen 完成真实对话。随后将同一个 `chat-demo` 切换到 SmolLM2：

- 服务名保持不变。
- 新 RayCluster 健康后稳定 Service 自动切换。
- 旧 Qwen RayCluster 和 Pod 自动回收。
- SmolLM2 完成真实对话。

### 4.5 封装 Helm Chart 和外部路由

新增 `charts/modelservice`，将模型相关字段参数化：

```text
modelId
modelDirectory
artifactFile
artifactRevision
artifactChecksum
```

Chart 生成：

```text
RayService
HTTPRoute
部署后验证 Job
```

Envoy Gateway 原来只允许 `demo` namespace 中的 HTTPRoute。将
`allowedRoutes` 改为 namespace 名称白名单，仅允许：

```text
demo
models
```

宿主机 `30080` 已被 Dagster 使用，因此没有停止或修改 Dagster。POC 使用：

```text
110.120.0.3:30081
-> Envoy Gateway
-> HTTPRoute
-> chat-demo-serve-svc:8000
```

当前 `30081` 由 `kubectl port-forward` 提供，尚未持久化。

### 4.6 发布内部 Helm Chart

当前内部 Helm 仓库采用：

```text
Chart .tgz 和 index.yaml
-> ConfigMap helm-repo-content
-> 挂载到 Nginx
-> ClusterIP Service
```

已发布：

```text
modelservice-0.1.0.tgz
modelservice-0.2.0.tgz
```

内部地址：

```text
http://helm-repo.platform-system.svc.cluster.local
```

模型权重不存放在 Helm 仓库，仍由 Artifact Keeper 管理。

### 4.7 创建 ModelService 平台 API

新增 Crossplane XRD：

```text
apiVersion: platform.example.com/v1alpha1
kind: ModelService
```

用户只填写五个模型字段。Composition 创建 provider-helm `Release`，从内部
Helm 仓库下载 `modelservice` Chart。

当前对象：

```text
models/chat-demo
ModelService: Synced=True, Ready=True
Release:      Synced=True, Ready=True
RayService:   Running
```

### 4.8 增加部署后自动验证

`modelservice-0.2.0` 增加 `post-install,post-upgrade` Helm Hook Job：

1. 等待 `/v1/models` 返回预期模型 ID。
2. 调用 `/v1/chat/completions`。
3. 校验响应中的模型 ID 和回复内容。
4. 成功后删除 Job，失败时保留日志。

Job 最大资源：

```text
CPU:    200m
Memory: 128Mi
NPU:    0
GPU:    0
```

Helm 升级到 0.2.0 后验证成功。Crossplane 首次观察处于升级中的 Release 时
短暂显示 `Ready=False`，再次观察后恢复 `Ready=True`。

### 4.9 接入 Argo CD GitOps

新增 `chat-demo-modelservice` Application，由现有
`platform-appservices` 父 Application 创建和管理。子 Application 监听：

```text
crossplane-backstage-poc/gitops/modelservices/chat-demo
```

向 Gitea 提交 Qwen 到 SmolLM2 的变更后，链路自动执行：

```text
Argo CD
-> ModelService
-> Crossplane Release
-> Helm
-> RayService
-> 新 RayCluster
-> 自动对话验证
-> 流量切换
```

首次提交误将 SmolLM2 制品名写为
`smollm2-360m-instruct-7ae55760.tar.gz`。Artifact Keeper 返回 404，新
RayCluster 初始化失败，但旧 Qwen 集群持续提供服务。修正为
`smollm2-360m-instruct-a10cc151.tar.gz` 后，SmolLM2 下载、SHA256 校验、
加载、真实对话和流量切换全部成功，旧 Qwen 集群随后自动回收。

最终状态：

```text
Argo CD:     Synced, Healthy
ModelService: Synced=True, Ready=True
RayService:  Running, pending cluster empty
Active model: smollm2-360m-instruct
```

## 5. 已处理问题

| 问题 | 原因 | 处理 |
|---|---|---|
| pip 下载超时 | 集群无法稳定访问外网 | 在外部构建 Runtime，集群内离线运行 |
| SmolLM2 占用 4.7GiB | 下载包含多个 ONNX 变体 | POC 只保留 Transformers 权重 |
| Artifact 上传连接重置 | 大文件经过 Web 转发不稳定 | 直接转发 Backend 上传 |
| Ray Serve 部署失败 | head Pod 2Gi 内存不足 | head limit 提升到 4Gi |
| 请求返回其他 vLLM 模型 | IPv4 端口被现有 vLLM 占用 | 使用独立端口并检查监听进程 |
| `30080` 返回 Dagster | 宿主机该端口属于 Dagster | 模型入口改用 `30081` |
| Helm 接管后资源被删除 | Helm 4 SSA 冲突且自动回滚卸载 | 资源清理后由 Helm 从零创建 |
| Crossplane 暂时 Ready=False | 升级后尚未再次观察 | 触发安全重观察，状态恢复 |
| SmolLM2 下载返回 404 | GitOps 声明中的制品版本标识错误 | 修正文件名并重新同步 |
| 修正后 Helm 未立即更新 | 失败部署的 Hook Job 仍在等待 | 终止失败验证 Job 并触发 Release 重观察 |

## 6. 当前资源边界

单套 RayService 最大限制：

```text
head:   1 CPU / 4Gi
worker: 4 CPU / 8Gi
total:  5 CPU / 12Gi
```

模型切换时 KubeRay 会短暂并行新旧 RayCluster，随后回收旧集群。Artifact
Keeper、KubeRay 和模型服务均运行在现有 Kind 集群，不使用 NPU/GPU。

## 7. 后续阶段

### 阶段 1：Argo CD GitOps 接管（已完成）

- 父 Application 已创建并管理模型服务子 Application。
- 子 Application 已监听 `gitops/modelservices/chat-demo/modelservice.yaml`。
- 已验证 Gitea 提交后自动切换至 SmolLM2。
- 已验证新模型失败时旧模型继续提供服务。

### 阶段 2：模型专用 Tekton CI

- 校验 ModelService schema。
- 校验 Artifact Keeper 文件存在。
- 校验 revision 和 SHA256。
- 通过后更新 GitOps 声明。

### 阶段 3：Backstage 自服务

- 接入 Gitea Catalog。
- 增加模型选择模板和 PR Action。
- 展示 Argo、Crossplane、RayService 和验证状态。
- 使用固定地址进入对话页面。

### 阶段 4：入口持久化

- 取消临时 port-forward。
- 使用受管理的反向代理、systemd 转发或集群 LoadBalancer。
- 为模型域名增加 HTTPS。

### 后续演进

- 接入训练模型发布渠道。
- 增加审批、签名、审计和回滚。
- 在独立阶段设计 NPU Runtime、调度和资源配额。

## 8. 阶段完成标准

POC 完成需同时满足：

1. Backstage 可以选择 Qwen 或 SmolLM2。
2. 选择结果通过 Gitea PR 或受控提交进入 Git。
3. Tekton 完成模型制品校验。
4. Argo CD 自动同步 ModelService。
5. Crossplane 和 Helm 自动部署或切换模型。
6. Hook Job 完成真实对话验证。
7. 固定 URL 返回新模型且可进行对话。
8. 整条链路不访问公网、不使用 NPU/GPU。
