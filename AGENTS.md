# 模型服务 POC 协作与恢复指南

## 1. 使用目的

本文件用于在缺失聊天上下文时恢复工作。后续代理应先阅读本文件和
`model-serving-poc-design.md`，再给出命令或修改方案。

用户的最终目标不是只运行一个模型，而是完成以下可演示闭环：

```text
Backstage 选择或切换模型
-> 提交 Gitea
-> Gitea Webhook 触发 Tekton
-> Tekton 校验制品并更新 GitOps
-> Argo CD 同步
-> Crossplane ModelService 创建 Helm Release
-> KubeRay RayService 部署或切换模型
-> 自动对话验证
-> Backstage 使用固定 URL 对话
```

必须支持至少两个模型，并用同一个服务名完成 A -> B -> A 切换。模型切换期间
不访问公网、不执行 `pip install`、不重建 Runtime 基础镜像。

## 2. 协作方式

- 使用中文解释，先讲清当前步骤的作用，再给精确命令。
- 一次推进一个可验证阶段，不要一次发送十几个相互依赖的操作。
- 每条命令明确说明在哪台机器、哪个用户、哪个目录执行。
- 用户主要通过 SSH 操作纯命令行服务器。
- 用户复制长 `python -c` 时多次发生自动换行和前导空格，导致
  `IndentationError` 或字符串中断。需要 Python 代码时优先让用户用 `nano`
  创建脚本，再用容器运行脚本。
- 创建 Python 文件后先用 `sed -n '1,40l'` 检查前导空格，再做语法检查。
- 不要让用户重复执行已经完成并验证的步骤。
- 不要把 Token、密码、Webhook Secret 或 Docker credentials 写入 Git、文档或
  聊天回复。只使用环境变量、Kubernetes Secret 和长度检查。
- 删除资源前确认它是临时验证资源；不要清理现有平台组件或用户未提交文件。

## 3. 机器与目录

### 3.1 `server-00`

- Kubernetes、Kind、Docker、Helm、Gitea 工作目录所在服务器。
- SSH 用户通常为 `admin`。
- Kind context 应为 `kind-platform-poc-2`。
- 主要实现仓库：
  - 推荐工作目录：`~/Markdown-ci`
  - 不推荐直接修改：`~/Markdown`，该目录曾有多项用户未提交配置和大 tar 文件。
- 实现根目录：
  `~/Markdown-ci/crossplane-backstage-poc`
- Gitea 集群内仓库：
  `http://gitea-http.gitea.svc.cluster.local:3000/gitadmin/Markdown.git`
- 本地镜像仓库：
  `110.120.0.3:8889`

继续修改 `~/Markdown-ci` 前必须运行：

```bash
cd ~/Markdown-ci
git status --short
git branch --show-current
git remote -v
```

不要覆盖或暂存与当前模型服务无关的用户改动。

### 3.2 `jumper-0041-pub`

- 用于访问外网或镜像站、下载模型、构建需要 PyPI 的基础镜像。
- 模型操作阶段用户切换为 `root`，因此当前模型文件位于：
  - `/root/model-artifacts`
  - `/root/model-packages`
- Runtime 构建目录曾为：
  `~/ray-model-runtime-build`
- 不要假设 `ilya` 用户有 Docker Socket 权限；非 root 时使用 `sudo docker`。

### 3.3 本地 Material 文档仓库

- 路径：`/home/ilya/Desktop/Material`
- 远端：`https://github.com/Re1lya/Material.git`
- 详细方案：`model-serving-poc-design.md`
- 本文件只负责上下文恢复，具体架构以详细方案为准。

## 4. 集群基础状态

### 4.1 Kind

节点：

```text
kind-platform-poc-2-control-plane
kind-platform-poc-2-worker
kind-platform-poc-2-worker2
```

- Kubernetes：v1.35.0
- containerd：2.2.0
- StorageClass：`standard`，provisioner 为 `rancher.io/local-path`
- 当前 POC 只用 CPU、内存和磁盘，不使用 GPU/NPU。
- 后续最终环境会使用服务器 NPU，但不属于当前阶段。

所有 Kind 节点已配置 HTTP Registry：

```text
110.120.0.3:8889
```

对应 containerd hosts 配置已完成，现有 `fastapi-demo-2` 已证明 BuildKit 推送、
Kubernetes 拉取和 Argo 部署链路可用。

### 4.2 已存在平台

以下组件已运行：

- Gitea
- Tekton Pipelines 和 Triggers
- Argo CD
- Crossplane
- provider-helm
- provider-kubernetes
- Backstage
- Envoy Gateway
- 内部 Helm Repository

普通应用链路已经跑通：

```text
Gitea push
-> Webhook
-> Tekton clone/test/build/push/update-gitops
-> Argo CD
-> Crossplane AppService
-> provider-helm
-> Deployment
```

`AppService` 是 Crossplane XRD 生成的 CRD。模型服务将新增独立
`ModelService` XRD/CRD，而不是把模型字段继续塞进 `AppService`。

## 5. Artifact Keeper：已完成

源码/Chart 位于 `server-00`：

```text
~/artifact-keeper-iac
~/artifact-keeper-iac/charts/artifact-keeper
```

部署状态：

- namespace：`artifacts`
- Helm release：`artifact-keeper`
- Chart：1.7.5
- Backend：1.6.0
- Web：1.5.8
- PostgreSQL：16-alpine
- OpenSearch：2.19.1
- 四个主 Pod 已验证 `1/1 Running`

POC 已关闭：

- Trivy
- Scanner Adapter
- DependencyTrack
- Ingress
- NetworkPolicy
- ServiceMonitor

PVC：

```text
artifact-keeper-storage                    50Gi
postgres-data-artifact-keeper-postgres-0   10Gi
artifact-keeper-opensearch                 10Gi
```

模型仓库：

```text
Name:   model-artifacts
Key:    model-artifacts
Format: huggingface
Type:   hosted
Quota:  40GiB
```

Service Accounts：

```text
svc-model-publisher
svc-model-runtime
```

Publisher Token 曾创建并用于上传，名称误写为 `model-artifacts`，但名称不影响权限。
它的正确权限应为 `Read + Write` 且 repository restriction 为 `model-artifacts`。

Runtime Token 已创建为只读，并存入：

```text
namespace: models
Secret:    artifact-keeper-model-runtime
key:       token
```

Secret 中 token 长度已验证为 41。任何代理都不得读取或输出 Secret 内容。

内部 Backend：

```text
http://artifact-keeper-backend.artifacts.svc.cluster.local:8080
```

上传 API：

```text
PUT /api/v1/repositories/model-artifacts/artifacts/<file>
```

下载 API：

```text
GET /api/v1/repositories/model-artifacts/download/<file>
```

大文件上传不能走 Web UI 的 `13001` 代理。该路径曾出现 `Empty reply` 和
`Connection reset`，Backend 日志中没有收到 PUT。正确方法是 SSH 加
`kubectl port-forward` 直接连接 Backend，例如本地 `18081 -> Backend 8080`。

## 6. 模型制品：已完成

### 6.1 Qwen

```text
Upstream: Qwen/Qwen2.5-0.5B-Instruct
Revision: 7ae557604adf67be50417f59c2c2f167def9a775
Directory size: about 954Mi
Artifact: qwen2.5-0.5b-instruct-7ae55760.tar.gz
Artifact size: 786315160 bytes
SHA256: ebae292a487e413617d1cc7026f5cd5aab76c42f7d05f08644d79c18a1c02a3e
Artifact Keeper ID: 3e63a5d9-cfd7-4e02-ab90-4f0c93226ac3
```

离线验证：

```text
model_type: qwen2
parameters: 494032768
tokenizer: Qwen2TokenizerFast
generation: non-empty response
```

### 6.2 SmolLM2

```text
Upstream: HuggingFaceTB/SmolLM2-360M-Instruct
Revision: a10cc1512eabd3dde888204e902eca88bddb4951
Directory size after cleanup: about 694Mi
Artifact: smollm2-360m-instruct-a10cc151.tar.gz
Artifact size: 574179243 bytes
SHA256: f917a7998511a854dc93567d043c6f11ec5db03f76b55b2db973b286bdc0a2fa
Artifact Keeper ID: 10c7e211-310f-4c89-9712-88c46f95aadd
```

SmolLM2 仓库原先下载了约 4.1Gi ONNX 文件。ONNX、训练日志和训练结果已移到：

```text
/root/model-artifacts-excluded/smollm2-360m-instruct
```

不要重新打入 tar。

离线验证：

```text
model_type: llama
parameters: 361821120
tokenizer: GPT2TokenizerFast
generation: non-empty response
```

### 6.3 集群内验证

临时 Pod `models/artifact-download-check` 已完成以下操作：

- 使用 Runtime Secret 从内部 Artifact Keeper 下载两个 tar。
- 两个 SHA256 均为 `OK`。
- 两个 tar 均能解压且包含 `model.safetensors`。
- Pod 最终状态为 `Completed`。

如果该临时 Pod 仍存在，可以安全删除：

```bash
kubectl -n models delete pod artifact-download-check
```

不要重新下载或上传模型，除非 Artifact Keeper 中对应文件丢失或 checksum 不匹配。

## 7. KubeRay 与 Runtime：已完成

### 7.1 KubeRay

- Operator：1.6.0
- namespace：`kuberay-system`
- 监听 namespace：`models`
- Operator Pod 已验证 `1/1 Running`
- 以下 CRD 已存在：
  - `rayclusters.ray.io`
  - `rayjobs.ray.io`
  - `rayservices.ray.io`

Operator 镜像：

```text
110.120.0.3:8889/kuberay/operator:v1.6.0
```

### 7.2 Runtime 基础镜像

```text
110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
```

已验证版本：

```text
Python       3.10.19
Ray          2.52.0
PyTorch      2.5.1+cpu
Transformers 4.48.3
```

该镜像基于：

```text
110.120.0.3:8889/rayproject/ray:2.52.0
```

基础镜像是在可访问 PyPI 的 jumper 构建后，通过 tar 传入 server 并推送到本地
Registry。不要在 server 的 Dockerfile 中重新执行公网 `pip install`。

### 7.3 服务代码镜像

当前源文件：

```text
~/Markdown-ci/crossplane-backstage-poc/apps/model-chat-service/serve_app.py
~/Markdown-ci/crossplane-backstage-poc/apps/model-chat-service/Dockerfile
```

`serve_app.py` 已通过 `py_compile`。Dockerfile 只从 Runtime 基础镜像复制服务
代码，不安装依赖。

当前直接验证镜像：

```text
110.120.0.3:8889/platform/model-chat-service:poc-v1
```

Registry tags API 已确认存在 `poc-v1`。

`serve_app.py` 的目标 API：

```text
GET  /v1/models
POST /v1/chat/completions
```

它从环境变量读取：

```text
MODEL_ID
MODEL_REVISION
MODEL_CHECKSUM
MODEL_PATH
TORCH_NUM_THREADS
```

当前 `~/Markdown-ci` 可能因新增 `apps/model-chat-service` 而不再干净。继续前必须
检查 `git status`，不要假设代码已经提交。

## 8. 当前准确断点

最后完成的是：

```text
model-chat-service:poc-v1 已构建并推送
```

尚未创建任何模型 RayService，尚未实现 ModelService XRD、Composition、Chart、
Tekton 模型流水线或 Backstage 页面。

下一步不是重新处理模型，而是：

1. 查看已安装 KubeRay CRD 的准确字段：

   ```bash
   kubectl explain rayservice.spec --api-version=ray.io/v1
   kubectl explain rayservice.spec.rayClusterConfig --api-version=ray.io/v1
   ```

   如果第二条字段不存在，再查看 `rayClusterSpec`。

2. 按集群实际 CRD 创建原始 Qwen `RayService`。
3. Worker initContainer 使用本地 Alpine 镜像、Runtime Secret、内部下载 API 和
   Qwen SHA256。
4. 模型解压到 `emptyDir`，Worker 使用
   `model-chat-service:poc-v1` 加载。
5. 先在集群内调用 `/v1/models` 和一次中文对话。
6. 修改同一个 RayService 为 SmolLM2，验证固定 Service 地址和切换。

不要跳过原始 RayService 验证直接编写 Crossplane 封装。模型下载、Ray Serve
调度和 KubeRay 更新行为是当前最需要先验证的风险。

## 9. RayService 直接验证要求

计划资源：

```text
Ray Head:
  request 500m CPU / 1Gi memory
  limit   1 CPU / 2Gi memory
  ray num-cpus = 0

Ray Worker:
  replicas 1
  request 2 CPU / 4Gi memory
  limit   4 CPU / 8Gi memory

Model emptyDir:
  sizeLimit 3Gi or 4Gi
```

Head 和 Worker 都使用服务代码镜像，确保 Ray Serve Controller 和 Replica 都能
导入 `serve_app:deployment`。只有 Worker 下载并挂载模型。由于 Head 的 Ray
CPU 为 0，Serve Replica 应调度到 Worker。

initContainer 必须：

1. 从 Secret 读取 Runtime Token。
2. 从 Artifact Keeper 内部 Service 下载固定文件名。
3. 校验完整 SHA256。
4. 解压模型。
5. 检查 `model.safetensors` 存在。
6. 失败时让 Pod 初始化失败，不能忽略 checksum。

使用 `serveConfigV2`，且不能配置任何公网 `runtime_env.working_dir` 或 pip 依赖。

## 10. 后续实现顺序

原始 RayService 验证成功后，严格按以下顺序推进：

1. Qwen 直接部署与对话。
2. 同服务切换 SmolLM2。
3. 补充服务代码测试并将临时镜像标签改为 Git SHA。
4. 新增 `platform-modelservice` Helm Chart：
   - RayService
   - HTTPRoute
   - post-install/post-upgrade 对话验证 Job
5. 新增 Crossplane：
   - `modelservice-xrd.yaml`
   - `modelservice-composition.yaml`
6. 将 Chart 打包进现有内部 Helm Repository。
7. 新增 GitOps ModelService 和 Argo CD Application。
8. 新增模型 Catalog：
   - Qwen `catalog-info.yaml` / `model-release.yaml`
   - SmolLM2 `catalog-info.yaml` / `model-release.yaml`
9. 新增两条 Tekton 路径：
   - 服务代码 test/build/push/update-gitops
   - 模型部署请求 validate/promote/update-gitops
10. 配置 Gitea Webhook，使用 `[skip ci]` 避免 GitOps 回写循环。
11. 实现 Backstage Gitea Catalog、Deploy Action、状态展示和 Chat。

## 11. ModelService 约束

`ModelService` 是 Crossplane XRD 生成的 Kubernetes CRD。

使用者只允许选择：

- Catalog 中登记的 `modelRef`
- 受控服务名
- 允许范围内的 CPU/内存

使用者不得输入：

- 任意 Artifact URL
- 任意 Runtime 镜像
- 任意本地模型路径
- 任意 Kubernetes namespace

平台根据 `modelRef` 固定映射：

- Artifact Keeper repository/file/checksum
- Runtime profile
- 服务代码镜像
- Secret 名称
- 资源与 HTTPRoute

同一 `chat-demo` 服务切换模型时，对外地址保持：

```text
http://chat-demo.models.poc:30080/v1
```

切换后 `/v1/models` 必须展示新的 model ID、revision 和 checksum。

## 12. 网络与镜像约束

- 集群和 server 不应直接访问公网。
- Docker Hub 官方镜像可通过 `dockerproxy.net` 获取。
- GHCR 镜像曾通过 `ghcr.dockerproxy.net` 获取。
- Quay 镜像曾通过 `quay.dockerproxy.net` 获取。
- 最终 Kubernetes YAML 和 Helm values 只能引用 `110.120.0.3:8889`。
- Docker Proxy 只用于一次性转存，不作为运行时依赖。
- Python 依赖已经固化在 Runtime 镜像中，不要重新引入 PyPI 下载。
- 模型已固化在 Artifact Keeper 中，不要让 Ray Pod 设置公网 Hugging Face
  endpoint。

## 13. Git 与提交规则

- 实现仓库以 Gitea `main` 为当前 POC 真相来源。
- `~/Markdown-ci` 是推荐的干净工作目录。
- `~/Markdown` 可能包含用户未提交平台配置和大型 tar，不得重置、覆盖或全部
  暂存。
- 提交前：

  ```bash
  git status --short
  git diff --check
  git diff --stat
  ```

- 只 `git add` 当前任务明确涉及的文件。
- Gitea 远端可能在流水线回写后领先本地。推送前先 fetch，必要时 stash 无关
  改动并执行 rebase；不要 force push。
- Token 使用环境变量，不要嵌入 remote URL、命令输出或 Git 文件。

## 14. 验收标准

只有全部满足才算 POC 完成：

- 两个模型均由 Artifact Keeper 提供，Ray Worker 不访问公网。
- Backstage Catalog 展示两个模型及不可变 revision/checksum。
- Backstage 可以部署 `chat-demo`。
- Gitea Webhook 自动触发 Tekton。
- Tekton 校验制品并更新 GitOps。
- Argo CD 显示 Synced/Healthy。
- Crossplane `ModelService` 显示 Ready。
- KubeRay `RayService` 正常提供一个 Serve endpoint。
- 自动 Hook Job 完成真实非空对话。
- Backstage Chat 可以对话。
- 从 Qwen 切换到 SmolLM2 后 URL 不变，模型元数据变化。
- 可以切回 Qwen。
- 删除 GitOps ModelService 后资源自动回收。

## 15. 不应做的事

- 不要声称 POC 已完成；当前只完成到服务代码镜像。
- 不要把 Artifact Keeper 的 Hosted repository 描述成集群直连 Hugging Face。
  当前使用的是 Artifact Keeper 的通用 artifact PUT/download API。
- 不要把模型权重打入服务镜像。
- 不要把 Runtime 基础镜像、服务代码镜像和模型制品混成一个概念。
- 不要使用 `latest`。
- 不要在未验证原始 RayService 前开始 Backstage UI。
- 不要为了临时排错关闭 checksum、Token 或 GitOps self-heal。
- 不要输出任何 Secret。
