# 全自动模型服务 POC 方案

## 1. 目标

在现有 Gitea、Tekton、Argo CD、Crossplane、Envoy Gateway 和 Backstage POC 上，新增一个可演示的模型服务闭环：

~~~
模型制品进入 Artifact Keeper
-> Gitea 登记模型 revision
-> Backstage 选择模型并点击 Deploy
-> Backstage 提交 GitOps 到 Gitea main
-> Argo CD / Crossplane / KubeRay 部署模型
-> 自动调用对话 API 验证
-> Backstage Chat 页面与模型对话
~~~

本方案只验证部署与对话闭环，不建设生产级训练、NPU、认证、高可用或多租户平台。

## 2. POC 边界

### 包含

- CPU-only Qwen2.5-Coder-0.5B-Instruct。
- Artifact Keeper 作为内部 Hugging Face 兼容模型仓库。
- 两类制品来源：Hugging Face 同步模型、训练 Pipeline 产物。
- 单模型服务对应一个独立 RayService 和 RayCluster。
- 非流式 GET /v1/models 与 POST /v1/chat/completions。
- Backstage Gitea Catalog、Deploy Action 和最小 Chat 页面。
- Argo CD 自动同步与删除回收。
- Helm Hook Job 自动对话验证。

### 不包含

- GPU、NPU、训练算法、模型评测、自动扩缩容、灰度发布。
- 集群直接访问公网 Hugging Face。
- TLS、API Key、限流、审计、生产审批和多租户。
- PVC、NFS、对象存储和节点模型缓存。

## 3. 关键约束

### 3.1 模型、Runtime 与镜像分离

~~~
Runtime 镜像
= Ray、Ray Serve、CPU PyTorch、Transformers、服务代码

模型制品
= 权重、config.json、tokenizer、generation 配置
~~~

固定 Runtime 镜像：

~~~
110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
~~~

模型权重不打入镜像；运行时不得下载公网依赖、执行 pip install 或 apt install。

### 3.2 无公网模型同步

集群没有公网出口，Artifact Keeper、Tekton 和 Ray Worker 不直接访问 Hugging Face。

~~~
Hugging Face URI
-> 有公网的外部同步机器
-> 下载完整快照并校验 SHA256
-> 上传 Artifact Keeper
-> 提交 Gitea model-release.yaml
~~~

训练模型按相同方式处理：

~~~
训练 Pipeline
-> 生成权重、配置、tokenizer
-> 校验 SHA256
-> 上传 Artifact Keeper
-> 更新 model-release revision
-> 自动更新开发环境 ModelService
~~~

Artifact Keeper 提供内部 Hugging Face Endpoint；Ray Worker 通过 HF_ENDPOINT 和内部 Token 下载固定 revision。[Artifact Keeper Hugging Face 指南](https://artifactkeeper.com/docs/guides/more-formats/)

### 3.3 单一所有者

| 资源 | 管理者 |
|---|---|
| 模型目录和 revision | Gitea |
| ModelService | Argo CD |
| Helm Release | Crossplane provider-helm |
| RayService、HTTPRoute、验证 Job | platform-modelservice Chart |
| RayCluster、Pod、Serve Service | KubeRay |
| 模型 Replica | Ray Serve |
| Deploy、Catalog、Chat | Backstage |

禁止 Argo CD 直接管理同名 RayService；禁止用户填写任意 Artifact URL、模型路径或 Runtime 镜像。

## 4. 低资源部署预算

当前 Kind 集群有充足 CPU、内存和约 963Gi 可用磁盘。POC 保持单副本，但按稳定演示而非最低资源配置部署。

### 4.1 稳态 requests 预算

| 组件 | 副本 | CPU request | 内存 request | 说明 |
|---|---:|---:|---:|---|
| Artifact Keeper backend | 1 | 500m | 1Gi | 内部制品 API |
| Artifact Keeper web | 1 | 100m | 128Mi | 管理 UI |
| PostgreSQL | 1 | 250m | 512Mi | Artifact Keeper 元数据 |
| OpenSearch | 1 | 500m | 1Gi | 保留单节点搜索依赖 |
| KubeRay Operator | 1 | 100m | 128Mi | 控制器 |
| Ray Head | 1 | 500m | 1Gi | 不承载模型 |
| Ray Worker | 1 | 2 CPU | 4Gi | Qwen 0.5B 低并发推理 |
| 合计 | - | 约 4 CPU | 约 7.8Gi | 不含短时 Job |

建议 limits：Artifact Keeper backend 1 CPU / 2Gi，PostgreSQL 500m / 1Gi，OpenSearch 1 CPU / 2Gi，Ray Head 1 CPU / 2Gi，Ray Worker 4 CPU / 8Gi。CPU 推理仍不追求吞吐，但模型加载和一次真实对话有足够余量。

### 4.2 短时资源

| 组件 | CPU request | 内存 request | 说明 |
|---|---:|---:|---|
| model-fetcher initContainer | 250m | 512Mi | 下载内部模型快照 |
| 自动对话验证 Job | 100m | 256Mi | 一次性 API 检查 |
| Tekton 模型交付任务 | 500m | 1Gi | 仅训练产物发布时运行 |

### 4.3 存储预算

| PVC | 初始大小 | 用途 |
|---|---:|---|
| Artifact Keeper artifact data | 50Gi | 多个小模型快照与版本 |
| PostgreSQL | 10Gi | 元数据 |
| OpenSearch | 10Gi | 搜索索引 |
| 合计 | 70Gi | 使用现有 standard StorageClass |

Artifact Keeper 使用单副本开发配置。关闭 Trivy、DependencyTrack、监控、HPA、PDB、Ingress；OpenSearch 先保留单节点，只有在渲染 Chart 并确认后端不依赖它时才考虑关闭。官方 Chart 默认包含多个依赖，需要先渲染镜像和 Values 再安装。[Artifact Keeper Helm 文档](https://artifactkeeper.com/docs/deployment/helm/)

## 5. 模型目录与 API

Gitea 是可部署模型的真相来源：

~~~
catalog/models/qwen-coder/
├── catalog-info.yaml
└── model-release.yaml
~~~

model-release.yaml 由平台或 model-delivery Pipeline 更新：

~~~yaml
apiVersion: platform.example.com/v1alpha1
kind: ModelRelease
metadata:
  name: qwen-coder
spec:
  displayName: Qwen Coder POC
  artifact:
    protocol: huggingface
    endpoint: http://artifact-keeper.artifacts.svc.cluster.local/huggingface/main
    repository: platform/qwen-coder
    revision: 4f1d9c2e8b0a
    checksum: sha256:<snapshot-digest>
  runtime:
    image: 110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
~~~

ModelRelease 是 Git 元数据，不是 Kubernetes CRD。Backstage Deploy Action 只读取 allowlist 中的模型，把固定制品信息复制到 ModelService。

~~~yaml
apiVersion: platform.example.com/v1alpha1
kind: ModelService
metadata:
  name: qwen-coder-dev
  namespace: models
spec:
  model:
    id: qwen-coder
    artifact:
      repository: platform/qwen-coder
      revision: 4f1d9c2e8b0a
      checksum: sha256:<snapshot-digest>
  runtime:
    image: 110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
~~~

服务 URL 从名称派生：

~~~
http://qwen-coder-dev.models.poc:30080/v1
~~~

客户端 hosts 文件：

~~~
110.120.0.3 qwen-coder-dev.models.poc
~~~

POC 为 HTTP-only、无 API Key 的受控内网演示。

## 6. 部署实现

### 6.1 Ray Worker

每个 ModelService 生成一个 Helm Release、RayService 和 RayCluster。

- Head 设定 num-cpus: "0"，只承载控制面。
- Worker 使用一个 Replica。
- initContainer 以固定 repository、revision、checksum 从 Artifact Keeper 下载到 emptyDir。
- Runtime 从 /models/current 加载模型。
- Worker 重启会重新下载模型，POC 接受这一成本。

对外 API 仅支持：

~~~
GET  /v1/models
POST /v1/chat/completions
~~~

仅支持 stream=false；不支持 tools、embeddings 和多模型动态加载。

### 6.2 Crossplane 与 Argo CD

~~~
Argo CD
-> ModelService
-> Crossplane Composition
-> provider-helm Release
-> platform-modelservice Chart
-> RayService + HTTPRoute + 验证 Job
-> KubeRay
~~~

Argo CD Application 必须开启：

~~~yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
~~~

删除 ModelService GitOps 定义后，Argo CD、Crossplane、Helm 与 KubeRay 依次回收所有模型资源。

### 6.3 自动对话验证

platform-modelservice Chart 创建 Helm post-install 和 post-upgrade Hook Job：

~~~yaml
metadata:
  annotations:
    helm.sh/hook: post-install,post-upgrade
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
~~~

Job 轮询模型 API，并执行：

1. GET /v1/models 返回 200。
2. POST /v1/chat/completions 发送固定 prompt。
3. 校验 HTTP 200、choices 存在且回复非空。

成功后 ModelService 显示 Ready；失败时 Release 失败并保留日志。该 Job 是部署质量检查，不替代用户 Chat。

## 7. Backstage 体验

### 7.1 Catalog

Backstage 配置 Gitea integration 和 Token，通过固定 Catalog Location 读取模型实体。第一版不需要 Gitea Discovery Provider。

Catalog 展示模型信息、artifact revision、Kubernetes 状态、API 链接和 Chat 入口。

### 7.2 Deploy

Backstage 实现 deploy:model-service Action：

~~~
选择 Catalog 模型和服务名
-> 读取 model-release.yaml
-> 生成受控 ModelService GitOps 文件
-> 直接提交 Gitea main
-> 显示部署状态
~~~

POC 允许直接提交 main；生产环境改为 PR、审批和策略检查。

### 7.3 Chat

Backstage 提供最小 Chat 页面：

~~~
选择 Ready 模型服务
-> 输入 prompt
-> Backstage 后端代理 /v1/chat/completions
-> 显示非流式回复
~~~

后端只代理 Catalog 已登记且 Ready 的 endpoint，禁止用户传入任意 URL。

## 8. 实施顺序

1. 获取 Artifact Keeper Chart，渲染所有资源和镜像清单。
2. 将 Chart 所需镜像同步到本地 Registry，编写低资源 Values。
3. 部署 Artifact Keeper，验证 PVC、Token 和内部 HF Endpoint。
4. 从有公网机器同步 Qwen 快照到 Artifact Keeper。
5. 构建 model-fetcher 与 CPU Runtime 镜像，推送本地 Registry。
6. 安装 KubeRay，手工验证原始 RayService 下载、加载和对话。
7. 实现 ModelService XRD、Composition、platform-modelservice Chart 与验证 Hook。
8. 接入 Argo CD，验证 revision 更新、自动测试和删除回收。
9. 实现 Backstage Gitea Catalog、Deploy Action 与 Chat 页面。

## 9. POC 验收

- Artifact Keeper 提供内部 Hugging Face 模型快照。
- Ray Worker 只访问内部 Artifact Keeper，不访问公网。
- 一个 ModelService 创建一个独立 RayService 和 RayCluster。
- 新 artifact revision 会自动滚动部署。
- 自动验证 Job 能完成一次真实模型对话。
- Backstage 可选择模型、点击 Deploy、等待 Ready 并进行对话。
- 删除 GitOps 定义后，模型资源被自动回收。

## 10. 后续演进

后续接入服务器 NPU 时，替换 Runtime、调度和资源声明；保持 Artifact Keeper、ModelRelease、ModelService、Gitea、Argo CD、Crossplane 和 Backstage 的交互契约不变。
