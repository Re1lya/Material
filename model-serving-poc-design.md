# 全自动多模型服务 POC 方案与执行路线

> 实际实施进度、验证结果和问题处理记录见
> `model-serving-poc-implementation-log.md`。

## 1. 目标

在现有 Gitea、Tekton、Argo CD、Crossplane、Envoy Gateway 和 Backstage POC 上，增加一条可现场演示的多模型服务链路：

```text
模型制品进入 Artifact Keeper
-> Gitea Catalog 登记不可变版本
-> Backstage 选择模型并提交部署请求
-> Gitea Webhook 触发 Tekton 校验
-> Tekton 更新 ModelService GitOps 配置
-> Argo CD、Crossplane、Helm 和 KubeRay 自动部署
-> 自动执行真实对话验证
-> Backstage Chat 使用固定服务地址对话
```

POC 必须演示：

1. 从模型目录选择并部署模型。
2. 使用同一服务名从模型 A 切换到模型 B。
3. 切换后服务地址不变，模型 ID、revision 和回复发生变化。
4. 部署和切换阶段不访问公网，不重新下载 Python 包。
5. GitOps 状态可追溯，失败时可定位到 Tekton、Helm Hook 或 RayService。

首批模型：

| 模型 | 上游 revision | 清理后大小 | 用途 |
|---|---|---:|---|
| Qwen/Qwen2.5-0.5B-Instruct | `7ae557604adf67be50417f59c2c2f167def9a775` | 约 954Mi | 中文对话演示 |
| HuggingFaceTB/SmolLM2-360M-Instruct | `a10cc1512eabd3dde888204e902eca88bddb4951` | 约 694Mi | 第二模型和切换演示 |

## 2. POC 边界

### 2.1 包含

- 只使用 Kind 集群的 CPU、内存和本地磁盘。
- Artifact Keeper 保存模型压缩包和版本。
- Gitea 保存模型元数据、部署请求和 GitOps 期望状态。
- Tekton 负责代码 CI、模型部署请求校验和 GitOps 更新。
- Argo CD 负责持续同步。
- Crossplane XRD/Composition 提供平台级 `ModelService` CRD。
- KubeRay `RayService` 管理 RayCluster 和 Ray Serve。
- OpenAI 风格的非流式 `GET /v1/models` 和 `POST /v1/chat/completions` API。
- Backstage Catalog、Deploy Action、部署状态和最小 Chat 页面。
- Helm Hook Job 在安装和切换后自动完成真实对话验证。

### 2.2 不包含

- GPU、NPU、训练算法、在线微调、自动扩缩容和多副本高可用。
- 集群直接访问 Hugging Face、PyPI、GHCR 或 Docker Hub。
- 流式输出、tools、embeddings、动态多模型加载。
- TLS、API Key、限流、生产审批、审计和多租户隔离。
- 共享模型缓存、NFS、对象存储或 PVC 级模型复用。

NPU 是后续运行时实现，不影响本方案的模型元数据、GitOps 和平台 API 契约。

## 3. 当前已完成状态

截至 2026-07-24：

| 项目 | 状态 | 结果 |
|---|---|---|
| 本地镜像仓库 | 已完成 | `110.120.0.3:8889` 可供 Docker、BuildKit 和 Kind/containerd 使用 |
| Artifact Keeper | 已完成 | Backend 1.6.0、Web 1.5.8、PostgreSQL、OpenSearch 均健康 |
| 模型仓库 | 已完成 | Hugging Face 类型 Hosted 仓库，key 为 `model-artifacts`，quota 40GiB |
| Artifact Keeper 身份 | 已创建 | `svc-model-publisher`、`svc-model-runtime`，Token 延迟到使用时创建 |
| KubeRay | 已完成 | Operator 1.6.0，监听 `models` namespace |
| Ray 基础镜像 | 已完成 | `110.120.0.3:8889/rayproject/ray:2.52.0` |
| CPU Runtime 基础镜像 | 已完成 | `110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1` |
| Runtime 依赖验证 | 已完成 | Python 3.10.19、Ray 2.52.0、PyTorch 2.5.1+cpu、Transformers 4.48.3 |
| 两个模型快照 | 已下载 | Qwen 约 954Mi，SmolLM2 移除无用 ONNX 后约 694Mi |
| 模型离线加载验证 | 进行中 | 需要分别完成 tokenizer、权重和一次生成验证 |
| 模型上传 Artifact Keeper | 未开始 | 离线验证后打包、计算 SHA256、上传 |
| ModelService 平台实现 | 未开始 | XRD、Composition、Chart、Argo 和 Tekton |
| Backstage 多模型体验 | 未开始 | Catalog、Deploy Action、状态和 Chat |

## 4. 核心设计

### 4.1 三层分离

```text
Runtime 基础镜像
= Ray + Ray Serve + CPU PyTorch + Transformers

服务代码镜像
= Runtime 基础镜像 + OpenAI API 和模型加载代码

模型制品
= safetensors + config + tokenizer + generation config
```

固定 Runtime 基础镜像：

```text
110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
```

模型服务代码使用以下 Dockerfile，不执行 `pip install`：

```dockerfile
FROM 110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1

WORKDIR /home/ray/app
COPY --chown=ray:ray serve_app.py /home/ray/app/serve_app.py

USER ray
```

Tekton 只复制和测试服务代码，因此后续 CI 不访问 PyPI。模型版本变化只更新制品引用，不重建 Runtime 或服务代码镜像。

### 4.2 两条 CI/CD 路径

代码更新与模型切换是两种不同变更：

```text
服务代码更新
-> Gitea Webhook
-> Tekton test/build/push
-> 更新服务代码镜像 tag
-> Argo CD 部署
```

```text
Backstage 选择或切换模型
-> 提交 deploy-request.yaml
-> Gitea Webhook
-> Tekton 校验 Catalog、Artifact 和 checksum
-> 更新 ModelService values.yaml，提交信息包含 [skip ci]
-> Argo CD 部署
```

模型切换不做无意义的镜像构建。Tekton 在这条路径承担配置 CI、制品校验和 GitOps promotion。

### 4.3 模型切换语义

POC 使用一个稳定服务名，例如 `chat-demo`。切换模型时更新它的 `modelRef`，而不是让一个 Python 进程热替换权重：

```text
chat-demo + qwen2.5-0.5b
-> 更新 GitOps modelRef
-> chat-demo + smollm2-360m
```

KubeRay 创建加载新模型的 Ray 工作负载，验证成功后由稳定 Service 接管流量。对外地址保持：

```text
http://chat-demo.models.poc:30080/v1
```

API 必须返回当前版本：

```json
{
  "id": "smollm2-360m-instruct",
  "artifactRevision": "a10cc1512eabd3dde888204e902eca88bddb4951",
  "artifactChecksum": "sha256:<tar-digest>",
  "runtime": "poc-cpu-v1"
}
```

## 5. 模型制品

### 5.1 外部同步

集群没有公网出口。模型只在可访问 Hugging Face 的外部机器下载：

```text
Hugging Face 或镜像站
-> jumper 下载固定 upstream revision
-> 删除 ONNX、训练日志等推理无关文件
-> 使用 Runtime 镜像执行离线加载和生成验证
-> 打包 tar.gz
-> 计算 SHA256
-> 上传 Artifact Keeper
-> 提交 Gitea model-release.yaml
```

训练模型使用相同入口：

```text
训练 Pipeline
-> 导出 safetensors、config、tokenizer
-> 离线验证
-> 上传 Artifact Keeper
-> 提交新的 ModelRelease revision/checksum
```

渠道不同，部署契约相同。

### 5.2 Artifact Keeper API

实际仓库：

```text
Repository name: model-artifacts
Repository key:  model-artifacts
Format:          huggingface
Type:            hosted
Quota:           40GiB
```

上传：

```text
PUT /api/v1/repositories/model-artifacts/artifacts/<artifact-file>
Authorization: Bearer <svc-model-publisher-token>
```

下载：

```text
GET /api/v1/repositories/model-artifacts/download/<artifact-file>
Authorization: Bearer <svc-model-runtime-token>
```

集群内基础地址：

```text
http://artifact-keeper-backend.artifacts.svc.cluster.local:8080
```

Token 不进入 Git：

- Publisher Token 只保存在外部同步机或训练 Pipeline Secret。
- Runtime Token 保存在 `models` namespace 的 Kubernetes Secret。
- `model-fetcher` initContainer 从 Secret 读取 Token。

### 5.3 Gitea 模型目录

```text
crossplane-backstage-poc/catalog/models/
├── qwen2.5-0.5b-instruct/
│   ├── catalog-info.yaml
│   └── model-release.yaml
└── smollm2-360m-instruct/
    ├── catalog-info.yaml
    └── model-release.yaml
```

`ModelRelease` 是 Git 元数据，不是 Kubernetes CRD：

```yaml
apiVersion: platform.example.com/v1alpha1
kind: ModelRelease
metadata:
  name: qwen2.5-0.5b-instruct
spec:
  displayName: Qwen2.5 0.5B Instruct
  source:
    type: huggingface
    repository: Qwen/Qwen2.5-0.5B-Instruct
    revision: 7ae557604adf67be50417f59c2c2f167def9a775
  artifact:
    repository: model-artifacts
    file: qwen2.5-0.5b-instruct-7ae55760.tar.gz
    checksum: sha256:<tar-digest>
  runtimeProfile: cpu-transformers-v1
```

Backstage 只允许选择 Catalog 中的 `ModelRelease`，不允许用户填写任意 URL、文件路径或镜像。

## 6. ModelService 平台 API

### 6.1 概念

现有 `AppService` 是 Crossplane XRD 生成的 CRD：

```text
AppService XRD
-> AppService CRD
-> AppService Composition
-> provider-helm Release
-> 普通应用 Chart
```

`ModelService` 使用相同机制：

```text
ModelService XRD
-> ModelService CRD
-> ModelService Composition
-> provider-helm Release
-> platform-modelservice Chart
-> RayService + HTTPRoute + 验证 Job
```

普通应用继续使用 `AppService`；模型服务使用独立 `ModelService`。

### 6.2 GitOps 对象

```yaml
apiVersion: platform.example.com/v1alpha1
kind: ModelService
metadata:
  name: chat-demo
  namespace: models
spec:
  modelRef: qwen2.5-0.5b-instruct
  artifact:
    repository: model-artifacts
    file: qwen2.5-0.5b-instruct-7ae55760.tar.gz
    revision: 7ae557604adf67be50417f59c2c2f167def9a775
    checksum: sha256:<tar-digest>
  runtimeProfile: cpu-transformers-v1
  resources:
    cpu: "2"
    memory: 4Gi
```

XRD 校验必填字段；Composition 将字段映射到 Helm values。Runtime 镜像、Artifact Keeper endpoint 和 Secret 名由平台固定，不由使用者输入。

### 6.3 Chart 资源

每个 `ModelService` 生成：

- 一个 KubeRay `RayService`。
- 一个模型下载 `initContainer`。
- 一个 `emptyDir` 模型目录，建议 `sizeLimit: 4Gi`。
- 一个指向 Ray Serve 端口的 `HTTPRoute`。
- 一个 `post-install,post-upgrade` Helm Hook 验证 Job。

Ray Head 只承担控制面。一个 Worker Replica 使用 CPU 加载一个模型。Worker 重启会重新下载模型，POC 接受该成本。

### 6.4 自动验证

验证 Job：

1. 等待 `GET /v1/models` 返回 200。
2. 确认 model ID 和期望的 `modelRef` 一致。
3. 调用 `POST /v1/chat/completions`。
4. 校验 HTTP 200、`choices` 存在且回复非空。

Helm 注解：

```yaml
metadata:
  annotations:
    helm.sh/hook: post-install,post-upgrade
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
```

CPU 模型首次加载较慢，Crossplane Helm Release 的等待时间建议设置为 15 分钟。

## 7. GitOps 与 Backstage

### 7.1 仓库布局

```text
crossplane-backstage-poc/
├── apps/model-chat-service/
├── catalog/models/
├── charts/platform-modelservice/
├── charts/platform-crossplane/templates/
│   ├── modelservice-xrd.yaml
│   └── modelservice-composition.yaml
├── gitops/modelservices/chat-demo/
├── gitops/argocd/chat-demo-modelservice.yaml
└── gitops/tekton/
    ├── model-service-ci.yaml
    └── model-service-tasks.yaml
```

Argo CD Application 开启：

```yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
  syncOptions:
    - CreateNamespace=true
```

删除 ModelService GitOps 对象后，Argo CD、Crossplane、Helm 和 KubeRay 依次回收资源。

### 7.2 Backstage

Catalog 通过固定 Gitea Location 读取两个模型实体，展示：

- 模型名称和来源。
- upstream revision 和 Artifact checksum。
- 已部署服务及其 Ready 状态。
- 当前服务使用的模型版本。
- API 和 Chat 入口。

`deploy:model-service` Action：

```text
选择 Catalog 模型
-> 输入受控服务名
-> 写入 deploy-request.yaml
-> 提交 Gitea main
-> 显示 Tekton、Argo 和 ModelService 状态
```

Chat 页面只允许调用 Catalog 中已登记且 Ready 的服务，由 Backstage 后端代理请求，不能输入任意 URL。

## 8. 资源预算

### 8.1 稳态 requests

| 组件 | CPU | 内存 | 状态 |
|---|---:|---:|---|
| Artifact Keeper backend | 500m | 1Gi | 已部署 |
| Artifact Keeper web | 100m | 128Mi | 已部署 |
| PostgreSQL | 250m | 512Mi | 已部署 |
| OpenSearch | 500m | 1Gi | 已部署 |
| KubeRay Operator | 100m | 128Mi | 已部署 |
| Ray Head | 500m | 1Gi | 待部署 |
| Ray Worker | 2 CPU | 4Gi | 待部署 |
| 合计 | 约 4 CPU | 约 7.8Gi | 单模型稳态 |

建议 limits：

- Ray Head：1 CPU / 2Gi。
- Ray Worker：4 CPU / 8Gi。
- 单次生成限制 `max_new_tokens <= 128`，并发限制为 1。

KubeRay 在切换期间可能同时保留新旧工作负载，短时峰值预计约 6.5 CPU / 13Gi。当前 Kind 集群容量足够。

### 8.2 存储

| PVC | 大小 | 用途 |
|---|---:|---|
| Artifact Keeper data | 50Gi | 模型压缩包和版本 |
| PostgreSQL | 10Gi | 元数据 |
| OpenSearch | 10Gi | 搜索索引 |
| 合计 | 70Gi | `standard` StorageClass |

Artifact Keeper 已关闭 Trivy、Scanner Adapter、DependencyTrack、Ingress、NetworkPolicy 和 ServiceMonitor。

## 9. 分阶段执行路线

### 阶段 A：完成模型制品

1. 使用 Runtime 镜像离线加载两个模型。
2. 对每个模型执行一次固定 prompt 生成。
3. 分别打包为包含单一顶层目录的 `tar.gz`。
4. 计算并保存 SHA256。
5. 创建 Publisher Token，上传 Artifact Keeper。
6. 创建 Runtime 只读 Token 和 `models/artifact-keeper-model-runtime` Secret。
7. 从集群内下载并校验 checksum。

验收：两个 tar 均能通过内部 API 下载、解压和离线加载。

### 阶段 B：直接验证 RayService

1. 新增 `serve_app.py` 和无依赖下载的 Dockerfile。
2. 构建服务代码镜像并推送本地 Registry。
3. 创建一个原始 RayService，加载 Qwen。
4. 验证 `/v1/models` 和一次真实中文对话。
5. 将同一 RayService 改为 SmolLM2。
6. 验证地址不变、model ID/revision 变化。

验收：不经过 Crossplane 时，KubeRay 的下载、加载、切换和对话均正确。

### 阶段 C：平台封装

1. 新增 `ModelService` XRD。
2. 新增 `modelservice-helm-release` Composition。
3. 新增 `platform-modelservice` Chart。
4. 加入 HTTPRoute 和 Helm Hook 验证 Job。
5. 将 Chart 打包进现有内部 Helm 仓库。
6. 创建 GitOps ModelService 和 Argo CD Application。

验收：只提交 ModelService YAML 即可创建完整 RayService。

### 阶段 D：Tekton 自动化

1. 服务代码 Pipeline：测试、构建、推送、更新镜像 tag。
2. 模型部署 Pipeline：校验 ModelRelease、Artifact 可达性和 SHA256。
3. Pipeline 更新 GitOps values，并使用 `[skip ci]` 防止循环触发。
4. Gitea Webhook 自动触发。

验收：提交 deploy request 后无需手工执行 Helm 或 kubectl。

### 阶段 E：Backstage 演示

1. 注册两个 Gitea Catalog 模型。
2. 实现 `deploy:model-service` Action。
3. 展示 Tekton、Argo、Crossplane、RayService 状态。
4. 实现最小 Chat 页面。
5. 演示 Qwen -> SmolLM2 -> Qwen 切换。

验收：所有演示操作从 Backstage 开始和结束。

## 10. 最终演示脚本

1. 在 Backstage 打开 `chat-demo`，当前模型为 Qwen。
2. 输入中文 prompt，展示非空回复。
3. 在模型目录选择 SmolLM2，点击 Deploy。
4. 展示 Gitea commit、Tekton 成功、Argo Synced、ModelService Ready。
5. 刷新 `/v1/models`，确认模型和 revision 已变化。
6. 使用同一 Chat 页面和同一 URL 再次对话。
7. 切回 Qwen，重复自动部署。
8. 删除测试 ModelService，展示资源自动回收。

## 11. 后续演进

接入服务器 NPU 时只替换以下部分：

- Runtime 基础镜像和推理实现。
- `runtimeProfile` 到镜像、资源和调度规则的映射。
- NPU device plugin、nodeSelector、资源声明。
- 模型格式或量化策略。

Artifact Keeper、ModelRelease、ModelService、Gitea、Tekton、Argo CD、Crossplane、Backstage 和固定服务地址的契约保持不变。
