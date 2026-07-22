# 基于 Artifact Keeper、Crossplane、KubeRay 与 Backstage 的全自动模型服务 POC

## 1. 目标

本方案在现有 Kubernetes Developer Portal POC 上增加模型制品交付、模型服务部署和在线对话能力。

现有 POC 已验证：

- Gitea 承载代码与 GitOps，并以 Webhook 触发 Tekton。
- Tekton 构建应用镜像并推送到本地 Registry 110.120.0.3:8889。
- Argo CD 从 Gitea 同步 GitOps。
- Crossplane 使用现有 provider-helm 模式创建平台资源。
- Envoy Gateway 通过 NodePort 30080 暴露 HTTP 服务。
- Backstage 提供 Developer Portal 与 Catalog。

本 POC 要展示的闭环：

~~~
模型制品进入内部 Artifact Keeper
  -> Gitea 登记不可变模型 revision
  -> Backstage Catalog 展示可部署模型
  -> 用户点击 Deploy
  -> Backstage 受控提交 GitOps 到 Gitea main
  -> Argo CD 创建 ModelService
  -> Crossplane 创建 Helm Release
  -> Helm Chart 创建 RayService、Gateway 路由与验证 Job
  -> KubeRay 创建 RayCluster
  -> Ray Worker 从 Artifact Keeper 下载模型
  -> Ray Serve 加载模型
  -> 自动调用对话 API 验证
  -> Backstage 显示 Ready，并提供 Chat 页面
~~~

目标是验证模型制品、GitOps、部署、自动验证和用户对话的闭环；不是建设生产级训练、模型制品或 NPU 平台。

---

## 2. POC 范围

### 2.1 包含

- 部署 Artifact Keeper，作为集群内部模型制品库。
- 支持两类模型制品来源：Hugging Face 同步模型和训练 Pipeline 产物。
- Artifact Keeper 以 Hugging Face 兼容协议提供内部模型快照。
- 新增 ModelService 平台 API。
- 每个已部署模型服务创建独立 RayService 和 RayCluster。
- 使用 CPU-only Transformers + Ray Serve Runtime。
- 使用真实的 Qwen2.5-Coder-0.5B-Instruct 验证模型加载和对话。
- Runtime 镜像使用本地 Registry：
  110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1。
- Backstage 从 Gitea 展示模型 Catalog，并提供 Deploy 和 Chat 页面。
- Backstage Deploy Action 直接提交受控 GitOps 文件到 Gitea main。
- Helm Hook Job 自动调用 /v1/models 和 /v1/chat/completions。
- Argo CD 自动同步和 prune，删除 GitOps 定义时完整回收资源。

### 2.2 不包含

- GPU 或服务器 NPU 调度、驱动、Runtime 与资源模型。
- 模型训练、微调、评估算法本身；只定义训练产物接入接口。
- 集群直接访问公网 Hugging Face。
- Runtime 镜像 CI 的完整工程化。
- 多模型共享 RayCluster、自动扩缩容、蓝绿、灰度和流量分配。
- TLS、API Key、认证、限流、审计、多租户隔离和生产网络策略。
- PVC、NFS、对象存储、节点级模型缓存和多节点共享存储。
- 生产审批、PR 审核、模型签名和制品安全扫描策略。

---

## 3. 已确认架构决策

| 决策 | POC 方案 | 后续演进 |
|---|---|---|
| 推理硬件 | CPU-only | 服务器 NPU Runtime、调度和资源类型 |
| Runtime | Transformers + Ray Serve | 替换为 NPU 支持的推理引擎 |
| 模型制品 | Artifact Keeper Hugging Face 兼容仓库 | 缓存、复制、签名和生命周期策略 |
| HF 访问 | 有公网的外部同步端预先同步 | 专用出网同步服务或企业模型镜像 |
| 训练模型 | 训练 Pipeline 上传权重到 Artifact Keeper | 训练、评估和审批流水线 |
| Runtime 镜像 | 本地 Registry 固定标签 | Runtime CI、CPU/NPU 多变体 |
| 模型部署 | Backstage Deploy Action 直接提交 Gitea main | PR、审批、自动合并和 RBAC |
| 模型加载 | Ray Worker initContainer 下载到 emptyDir | PVC、节点缓存或共享存储 |
| API | 非流式 /v1/models、/v1/chat/completions | streaming、tools、embeddings |
| 访问 | HTTP Host 路由 | 企业 DNS、HTTPS、认证与限流 |
| 部署验证 | Helm Hook Job 自动发送固定对话 | 发布门禁、评测和灰度策略 |

---

## 4. 模型、Runtime 与镜像的边界

模型服务由两个独立制品组成：

~~~
Runtime 镜像
  = Ray、Ray Serve、CPU PyTorch、Transformers、服务代码和依赖

模型制品
  = 权重、config.json、tokenizer、generation 配置及其他模型文件
~~~

模型权重不打入 Runtime 镜像。训练模型通常也应作为模型制品上传，而不是构建成包含权重的大镜像。只有模型需要特殊推理代码或专用依赖时，才发布新的 Runtime 镜像。

固定 POC Runtime：

~~~
110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
~~~

Runtime 必须固定 Ray、PyTorch、Transformers 和 Python 版本，不使用 latest。模型启动期间不得执行 pip install、apt install 或访问公网。

---

## 5. 模型制品交付

### 5.1 Hugging Face 模型

集群没有公网或代理访问能力，因此 Artifact Keeper、Tekton 和 Ray Worker 不能直接访问 Hugging Face。首次同步由有公网能力的外部同步端执行：

~~~
Hugging Face URI + revision
  -> 外部 model-sync Job / 工作站
  -> 下载完整模型快照
  -> 校验 SHA256
  -> 上传 Artifact Keeper
  -> 提交 Gitea model-release.yaml
~~~

完整快照至少包含：

~~~
config.json
tokenizer.json / tokenizer_config.json
权重文件，例如 *.safetensors
generation_config.json
SHA256SUMS
~~~

Artifact Keeper 作为内部 Hugging Face Endpoint。Runtime 通过 HF_ENDPOINT 和内部 Token 下载固定 revision。Artifact Keeper 支持 huggingface_hub、transformers、snapshot_download 与 HfApi.upload_folder 使用的 Hugging Face 协议。[Artifact Keeper Hugging Face 指南](https://artifactkeeper.com/docs/guides/more-formats/)

### 5.2 训练模型

训练模型与 Hugging Face 模型在部署层没有差别：

~~~
Gitea 中训练代码 / 数据变更
  -> 训练 Pipeline
  -> 新权重、配置和 tokenizer
  -> SHA256 校验
  -> 上传 Artifact Keeper
  -> 写入新的 model-release revision
  -> 更新目标 ModelService 的 artifact revision
  -> Argo CD 自动滚动部署
~~~

训练数据在 Gitea 中更新不会自动改变模型能力。只有训练或微调 Pipeline 实际产出新的权重并上传 Artifact Keeper 后，才构成新的模型版本。

### 5.3 Artifact Keeper 的职责

Artifact Keeper 是内部制品库，不是模型部署控制器，也不应被假设为自动镜像所有公网 Hugging Face URI。模型同步、校验、上传和 revision 提交属于专门的 model-delivery 流程。

官方 Helm Chart 的默认组件可能包含 PostgreSQL、OpenSearch、Trivy、DependencyTrack 等，对单节点 Kind POC 有资源压力。部署前需采用精简 Values，并明确 Artifact Keeper、Ray Worker 和现有平台组件的资源预算。[Artifact Keeper Helm 文档](https://artifactkeeper.com/docs/deployment/helm/)

---

## 6. Gitea 模型目录与版本真相

不新增 ModelArtifact CRD。模型目录与可部署版本以 Gitea 中的受控文件为真相来源：

~~~
catalog/models/qwen-coder/
├── catalog-info.yaml
└── model-release.yaml
~~~

model-release.yaml 示例：

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
    checksum: sha256:<model-snapshot-digest>
  runtime:
    image: 110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
  compatibility:
    runtimeProfile: cpu-poc-v1
~~~

此处的 ModelRelease 是 GitOps 元数据文件，不是 Kubernetes CRD。它由平台管理员或 model-delivery Pipeline 更新；普通 Backstage 用户不可任意填写 Artifact URL、模型路径、Runtime 镜像或 revision。

Backstage Deploy Action 只能从该 allowlist 读取模型，并将不可变的 repository、revision、checksum 与 Runtime 镜像复制到新建或更新的 ModelService GitOps 定义。

对于已部署的开发环境模型服务，model-delivery Pipeline 可以更新其 pinned artifact revision，以展示：

~~~
新模型制品
  -> 自动部署
  -> 自动对话验证
~~~

生产环境改为显式 promotion 和审批。

---

## 7. ModelService API

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
      endpoint: http://artifact-keeper.artifacts.svc.cluster.local/huggingface/main
      repository: platform/qwen-coder
      revision: 4f1d9c2e8b0a
      checksum: sha256:<model-snapshot-digest>
  runtime:
    image: 110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
~~~

用户可选择服务名和 Catalog 中的模型；Deploy Action 填充制品与 Runtime 字段。

平台派生字段：

~~~
hostname
Ray Head / Worker 配置
模型下载 initContainer
CPU / 内存资源
Serve import path、端口和 HTTPRoute
Artifact Keeper Token Secret 引用
自动验证 Job 配置
~~~

hostname 从服务名派生：

~~~
ModelService: qwen-coder-dev
Hostname:     qwen-coder-dev.models.poc
API base URL: http://qwen-coder-dev.models.poc:30080/v1
~~~

状态由 Crossplane Helm Release 和自动验证 Job 汇总：

~~~yaml
status:
  conditions:
    - type: Ready
      status: "True"
      reason: ModelSmokeTestSucceeded
  endpoint:
    url: http://qwen-coder-dev.models.poc:30080/v1
  artifactRevision: 4f1d9c2e8b0a
~~~

---

## 8. 资源所有权

~~~text
Backstage
  -> 受控 GitOps commit 与 Catalog

Gitea main
  -> ModelService Helm Chart、Argo CD Application、ModelRelease 元数据

Argo CD
  -> ModelService

Crossplane Composition
  -> provider-helm Release

platform-modelservice Helm Chart
  -> RayService、HTTPRoute、下载 Secret 引用、验证 Hook Job

KubeRay Operator
  -> RayCluster、Head / Worker Pod、Serve Service

Ray Serve
  -> 模型 Replica 和 OpenAI-compatible API
~~~

禁止：

- Argo CD 直接管理 Crossplane 或 Helm 创建的 RayService。
- GitOps 中提交与 Release 同名的原始 RayService 或 HTTPRoute。
- Backstage 直接调用 Argo CD、Crossplane、RayService 或 Pod API。
- 用户通过表单传入任意 Artifact URI、路径和镜像。

删除链路：

~~~
删除 ModelService GitOps 定义
  -> Argo CD automated prune
  -> Crossplane 删除 Helm Release
  -> Helm 删除 RayService、HTTPRoute、Job
  -> KubeRay 删除 RayCluster、Pod 与 Service
~~~

模型实例对应的 Argo CD Application 必须启用：

~~~yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
~~~

---

## 9. RayService 与模型加载

每个 ModelService 生成一个独立运行边界：

~~~
1 ModelService
  -> 1 Helm Release
  -> 1 RayService
  -> 1 RayCluster
~~~

### 9.1 Head

Head 仅承载 Ray 控制面、Serve Controller 和 HTTP Proxy：

~~~yaml
headGroupSpec:
  rayStartParams:
    num-cpus: "0"
~~~

### 9.2 Worker

POC 使用一个 Worker 和固定资源：

~~~yaml
workerGroupSpecs:
  - groupName: model-workers
    replicas: 1
    template:
      spec:
        initContainers:
          - name: fetch-model
            image: 110.120.0.3:8889/platform/model-fetcher:poc-v1
            env:
              - name: HF_ENDPOINT
                valueFrom:
                  secretKeyRef:
                    name: artifact-keeper-hf
                    key: endpoint
              - name: HUGGING_FACE_HUB_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: artifact-keeper-hf
                    key: token
            volumeMounts:
              - name: model-data
                mountPath: /models
        containers:
          - name: ray-worker
            image: 110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
            env:
              - name: MODEL_PATH
                value: /models/current
            resources:
              requests:
                cpu: "2"
                memory: 4Gi
              limits:
                cpu: "4"
                memory: 8Gi
            volumeMounts:
              - name: model-data
                mountPath: /models
        volumes:
          - name: model-data
            emptyDir: {}
~~~

fetch-model 根据 ModelService 中固定的 repository、revision 与 checksum 执行 snapshot_download，校验完整快照后写入 /models/current。Worker 重建会从集群内 Artifact Keeper 重新下载；POC 接受这一成本。

Runtime 对外提供最小协议：

~~~
GET  /v1/models
POST /v1/chat/completions
~~~

限制：仅 stream=false，不支持 tools、function calling、embeddings 或多模型动态加载。

---

## 10. Gateway 与访问边界

每个模型服务生成 Host 匹配的 HTTPRoute，指向该 RayService 的 Serve Service。Chart 必须在固定 KubeRay 版本上验证实际 Serve Service 名称后再固化模板。

POC 客户端使用 hosts 文件解析：

~~~
110.120.0.3 qwen-coder-dev.models.poc
~~~

访问：

~~~
http://qwen-coder-dev.models.poc:30080/v1/models
http://qwen-coder-dev.models.poc:30080/v1/chat/completions
~~~

安全边界：

~~~
HTTP only
无 API Key
受控内网 / 演示环境
~~~

当前 Gateway 仅负责 Host 路由和转发。TLS、认证、限流、审计和企业 DNS 是后续工作。

---

## 11. GitOps、Backstage 与用户交互

### 11.1 Gitea Catalog

Backstage 配置 Gitea integration 和 Token，从 Gitea 中读取模型 Catalog 与 model-release.yaml。POC 可用固定 Catalog Location，不必先实现 Gitea Discovery Provider。

~~~text
catalog/models/<model>/catalog-info.yaml
catalog/models/<model>/model-release.yaml
gitops/modelservices/<service>/
~~~

Catalog 至少展示：

- 模型名称、owner、生命周期和内部 artifact revision。
- Deploy 状态与 Kubernetes 资源。
- OpenAI API 链接。
- Backstage Chat 页面链接。

### 11.2 Deploy Action

Backstage 实现受控的 deploy:model-service Action：

~~~
用户选择 Catalog 模型和服务名
  -> 读取 allowlist model-release.yaml
  -> 生成 ModelService GitOps Chart 与 Argo Application
  -> 直接 commit 到 Gitea main
  -> 返回部署状态页面
~~~

Action 只能创建平台规定目录中的 ModelService 文件，不能修改 model-release.yaml、Runtime 镜像、Artifact endpoint 或任意 Git 路径。

POC 为实现一键部署允许直接提交 main。生产阶段替换为分支、Pull Request、审批、策略检查和合并。

### 11.3 Chat 页面

Backstage 新增最小 Model Chat 页面：

~~~
选择已部署且 Ready=True 的模型服务
  -> 输入 prompt
  -> Backstage 后端代理调用该服务的 /v1/chat/completions
  -> 页面显示非流式回复
~~~

浏览器不直接访问模型 endpoint。Backstage 后端仅允许代理 Gitea Catalog 已登记、且 ModelService 状态为 Ready 的 endpoint，避免任意 URL 代理和 CORS 问题。

---

## 12. 自动部署验证

模型服务每次安装或 artifact revision 更新后，都必须自动执行一次真实对话验证。

验证 Job 由 platform-modelservice Helm Chart 作为 Helm Hook 创建：

~~~yaml
metadata:
  annotations:
    helm.sh/hook: post-install,post-upgrade
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
~~~

执行过程：

~~~
RayService 创建
  -> Worker 下载模型并启动 Ray Serve
  -> Hook Job 轮询 API
  -> GET /v1/models 必须返回 200
  -> POST /v1/chat/completions 发送固定 prompt
  -> 校验 HTTP 200、choices 存在且回复非空
  -> 成功：Release / ModelService Ready
  -> 失败：Release 失败并保留日志供排查
~~~

示例固定 prompt：

~~~json
{
  "model": "qwen-coder",
  "messages": [
    {"role": "user", "content": "Reply with: model ready"}
  ],
  "stream": false
}
~~~

该 Job 是部署质量检查，不替代 Backstage 用户聊天。

---

## 13. 分阶段实施顺序

### 阶段 0：容量、版本和本地镜像准备

1. 为 Artifact Keeper、Ray Worker 和现有平台组件制定单节点 Kind 资源预算。
2. 选择并锁定 KubeRay Operator、Ray CRD API、Ray、PyTorch、Transformers 兼容版本。
3. 将 Artifact Keeper、model-fetcher、Runtime 与依赖镜像导入或代理到可访问的镜像仓库。
4. 确认 Kind 节点能拉取 110.120.0.3:8889 的 HTTP Registry 镜像。

### 阶段 1：Artifact Keeper 与模型制品

1. 使用精简 Values 部署 Artifact Keeper。
2. 创建内部 Hugging Face 模型仓库、Token 与 Kubernetes Secret。
3. 在有公网的机器同步 Qwen 完整快照，校验 SHA256 后上传 Artifact Keeper。
4. 在集群内使用 snapshot_download 从 Artifact Keeper 验证模型快照。
5. 在 Gitea 创建 model-release.yaml 与 Catalog 实体。

### 阶段 2：原始 RayService 与 Runtime

1. 构建并推送 CPU Runtime 与 model-fetcher 镜像。
2. 安装 KubeRay Operator。
3. 手工提交原始 RayService，验证 initContainer 下载、模型加载和对话 API。
4. 验证 Gateway Host 路由。
5. 验证模型下载只访问 Artifact Keeper，不访问公网。

### 阶段 3：Crossplane 与 GitOps

1. 创建 ModelService XRD、Composition 和 RBAC。
2. Composition 使用现有 provider-helm 创建 Release。
3. 新增 platform-modelservice Chart，渲染 RayService、HTTPRoute 和验证 Hook Job。
4. 创建模型实例 Helm Chart 与 Argo CD Application。
5. 验证 artifact revision 更新会滚动部署并自动对话验证。
6. 验证 Argo CD prune 删除后完整回收资源。

### 阶段 4：Backstage 一键部署与 Chat

1. 配置 Gitea Catalog integration。
2. 实现 deploy:model-service Action，直接提交受控 GitOps 到 main。
3. 实现 Backstage Model Chat 前端与后端代理。
4. 重新构建并部署 Backstage。
5. 验证从 Catalog 选择模型、点击 Deploy、等待 Ready、进入 Chat 的闭环。

---

## 14. 验收标准

### 14.1 制品链路

- Artifact Keeper 可保存并以内部 Hugging Face Endpoint 提供完整模型快照。
- Hugging Face 同步模型和训练产物都能形成相同的内部 artifact repository + immutable revision。
- Ray Worker 不访问公网，只从 Artifact Keeper 下载模型。
- 下载的模型 revision 与 Gitea model-release.yaml 一致，并通过 checksum 校验。

### 14.2 部署链路

- Gitea ModelService 变更被 Argo CD 自动同步。
- Crossplane 创建 Helm Release，Chart 创建独立 RayService 和 RayCluster。
- Worker 使用固定 CPU 资源：requests 2 CPU / 4Gi，limits 4 CPU / 8Gi。
- Runtime 成功加载真实模型，/v1/models 返回 200。
- 自动验证 Job 成功调用非流式 /v1/chat/completions。
- ModelService.status 显示 Ready、endpoint 与 artifact revision。
- GitOps 删除实例后，Argo CD prune 自动回收模型资源。

### 14.3 用户体验

- Backstage Catalog 展示多个可部署模型。
- 用户选择一个模型并点击 Deploy 后，Backstage 受控提交 Gitea main。
- 页面能显示部署状态，Ready 后提供 Chat。
- Backstage Chat 能显示模型真实回复。

---

## 15. 风险与后续演进

| 风险 | POC 处理 | 后续方案 |
|---|---|---|
| 集群无公网 | 外部同步端预置 Artifact Keeper | 专用受控同步服务或企业镜像 |
| Artifact Keeper 资源开销 | 精简部署并先做容量预算 | 独立制品集群与高可用存储 |
| emptyDir 重启重下模型 | POC 接受 | PVC、节点缓存、共享存储 |
| CPU 推理慢 | 低并发演示 | NPU Runtime 与资源调优 |
| POC 直接 commit main | 仅受控演示环境 | PR、审批、策略和 RBAC |
| HTTP 无认证 | 仅内网演示 | DNS、TLS、API Key、限流、审计 |
| 自动验证仅覆盖固定 prompt | 验证可用性 | 评测集、质量门禁、回归测试 |

后续接入服务器 NPU 时，应替换 Runtime 镜像、调度策略和资源声明；保持 ModelRelease、ModelService、Gitea、Argo CD、Crossplane 与 Backstage 的交互契约不变。
