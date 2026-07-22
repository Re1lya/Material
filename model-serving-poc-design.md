# 基于 Crossplane、KubeRay 与 Backstage 的模型服务部署 POC 方案

## 1. 目标与结论

本文在现有 Kubernetes Developer Portal POC 上增加模型服务部署能力。现有 POC 已验证以下链路：

- Gitea 承载应用代码与 GitOps 配置，并通过 Webhook 触发 Tekton。
- Tekton 执行测试、构建镜像并推送到服务器本地 Registry `110.120.0.3:8889`。
- Argo CD 从 Gitea 同步 GitOps 配置。
- Crossplane 通过现有 `provider-helm` 模式创建平台资源。
- Envoy Gateway 经 NodePort `30080` 暴露 HTTP 服务。
- Backstage 用于 Catalog 和后续服务注册入口。

本 POC 的目标是验证一条可观察、可回收的模型服务部署链路，而不是建设完整的训练、模型制品或生产级推理平台：

```text
手工创建并合并 Gitea PR
  -> Argo CD 创建 ModelService
  -> Crossplane 创建 Helm Release
  -> platform-modelservice Helm Chart 创建 RayService 与 HTTPRoute
  -> KubeRay 创建 RayCluster
  -> Ray Serve 加载真实模型
  -> Envoy Gateway 暴露 OpenAI-compatible API
```

Backstage 自动生成 Gitea PR 是第二阶段，不阻塞第一阶段对模型服务底座的验证。

---

## 2. POC 边界

### 2.1 本阶段包含

- 新增 `ModelService` Crossplane 平台 API。
- 每个 `ModelService` 创建独立的 Helm Release、RayService 和 RayCluster。
- 使用 KubeRay 和 Ray Serve 运行真实模型。
- 使用 CPU-only Runtime 运行 `Qwen2.5-Coder-0.5B-Instruct`。
- 模型文件离线预置在服务器后，复制到指定 Kind Worker 节点。
- Runtime 镜像从服务器本地 Registry 拉取。
- 通过现有 Envoy Gateway 的 HTTP Host 路由暴露 `/v1` API。
- Argo CD 管理 `ModelService`，自动 prune 删除的模型服务。
- Backstage Catalog 展示模型服务、API 链接和 Kubernetes 资源。

### 2.2 本阶段不包含

- GPU 或服务器 NPU 调度、驱动、Runtime 或资源声明。
- 模型训练、微调、评估、模型上传和模型制品流水线。
- Runtime 镜像 CI；Runtime 通过预构建镜像交付。
- PVC、NFS、MinIO、S3、节点缓存或多节点共享模型存储。
- 自动扩缩容、蓝绿发布、灰度、流量分配和自动推理冒烟测试。
- TLS、API Key 校验、限流、审计或多租户隔离。
- 每个团队或模型独立 Namespace。
- Backstage 自定义实体类型或专属前端插件。

---

## 3. 已确认架构决策

| 决策 | POC 方案 | 后续演进 |
|---|---|---|
| 推理硬件 | CPU-only | 使用服务器 NPU，并引入对应 Runtime 与资源模型 |
| 模型 | 固定 `Qwen2.5-Coder-0.5B-Instruct` | allowlist 多模型与模型版本管理 |
| Runtime | Transformers + Ray Serve | 替换为 NPU 支持的推理引擎，不改变平台 API |
| 模型文件 | 离线预置 + `docker cp` 到 Kind Worker | `extraMounts`、PVC、NFS 或对象存储 |
| Runtime 镜像 | `110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1` | 固定 CPU/NPU Runtime 版本并建立 CI |
| API 入口 | `http://<service>.models.poc:30080/v1` | 企业 DNS、HTTPS、认证和限流 |
| 协议范围 | `/v1/models`、非流式 `/v1/chat/completions` | streaming、tools、embeddings 等完整兼容 |
| Crossplane 实现 | `provider-helm` 创建 Helm Release | 保持该抽象，按需要扩展 Chart |
| GitOps 删除 | Argo CD automated prune | 保留自动回收并增加策略控制 |
| Portal 自动化 | 第二阶段实现 Gitea PR Action | 完整自助服务与审批策略 |

---

## 4. 总体架构与资源所有权

```text
Developer / Operator
  -> Gitea Pull Request
  -> Gitea main
  -> Argo CD
  -> ModelService
  -> Crossplane Composition
  -> provider-helm Release
  -> platform-modelservice Helm Chart
  -> RayService + HTTPRoute
  -> KubeRay Operator
  -> RayCluster
  -> Ray Head + Ray Worker
  -> Ray Serve Runtime
  -> Envoy Gateway
  -> OpenAI-compatible API
```

### 4.1 单一所有者规则

| 资源 | 主要管理者 |
|---|---|
| 模型实例 GitOps Helm Chart | Gitea PR + Argo CD |
| `ModelService` | Argo CD |
| Helm Release | Crossplane Composition |
| `RayService`、HTTPRoute | `platform-modelservice` Helm Chart |
| RayCluster、Head/Worker Pod、Service | KubeRay Operator |
| Ray Serve Deployment / Replica | Ray Serve |
| 外部入口 | Envoy Gateway |

禁止以下操作：

- Argo CD 直接管理与 Helm Release 同名的 `RayService`。
- 人工修改 Crossplane / Helm 生成的 `RayService` 或 HTTPRoute。
- 在 GitOps 中再提交同名原始 `RayService`。
- Backstage 直接操作 Ray Pod 或 RayService。

### 4.2 删除链路

模型实例从 GitOps 删除后必须自动回收：

```text
Argo CD prune ModelService
  -> Crossplane 删除 Helm Release
  -> Helm 删除 RayService 和 HTTPRoute
  -> KubeRay 删除 RayCluster、Service 和 Pod
```

模型对应 Argo CD Application 必须启用：

```yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
```

---

## 5. ModelService v1alpha1 API

`ModelService` 是面向平台使用者的稳定抽象；KubeRay 的 `RayService` 是内部运行时实现。

```yaml
apiVersion: platform.example.com/v1alpha1
kind: ModelService
metadata:
  name: qwen-coder-poc
  namespace: models
spec:
  model:
    id: qwen2.5-coder-0.5b-instruct
    revision: poc-v1
```

### 5.1 公开字段

| 字段 | 规则 |
|---|---|
| `metadata.name` | DNS Label；也是服务名 |
| `spec.model.id` | POC 仅允许 `qwen2.5-coder-0.5b-instruct` |
| `spec.model.revision` | POC 固定为 `poc-v1` |

### 5.2 平台派生字段

以下字段不由用户填写，也不放入第一版 Backstage 表单：

```text
Runtime 镜像
模型物理路径与容器内路径
Kind Worker 节点选择器
Head / Worker 资源
Ray、Transformers、PyTorch 版本
Ray Serve import path 与端口
Gateway HTTPRoute
hostname
```

平台映射固定模型到容器内目录：

```text
qwen2.5-coder-0.5b-instruct
  -> /models/qwen2.5-coder-0.5b-instruct
```

`modelPath` 不属于公开 API。它只影响 Runtime 从哪个目录加载权重；允许用户填写会导致模型服务在不存在或不受控的路径启动失败。

### 5.3 状态

```yaml
status:
  conditions:
    - type: Ready
      status: "True"
      reason: RayServiceReady
      message: Ray Serve endpoint is available
  endpoint:
    url: http://qwen-coder-poc.models.poc:30080/v1
  modelRevision: poc-v1
```

POC 的 `Ready=True` 以 RayService 已就绪为准，不包含自动推理调用。真实的 `/v1/chat/completions` 调用是独立的人工验收项。

---

## 6. 模型文件与 Kind 节点

### 6.1 POC 文件流

模型权重不得由 Pod 启动时下载。由于当前环境公网访问不稳定，模型按离线方式准备：

```text
可联网机器下载模型
  -> 生成 SHA256 清单
  -> 传输到服务器 /srv/models/qwen2.5-coder-0.5b-instruct
  -> docker cp 到指定 Kind Worker 的 /srv/models/qwen2.5-coder-0.5b-instruct
  -> Ray Worker hostPath 只读挂载到 /models
```

模型目录至少应包含模型配置、权重和 tokenizer 文件，并随目录保留 `SHA256SUMS` 或等价校验清单。

### 6.2 为什么使用 `docker cp`

Kind 节点是 Docker 容器。Kubernetes `hostPath` 指向的是 **Kind 节点容器内**的目录，不是物理服务器目录。因此 POC 选择将模型目录复制进指定 Worker：

```text
服务器 /srv/models/... 
  -> Kind Worker 容器 /srv/models/...
  -> Ray Worker Pod /models/...
```

该方案最快且不要求重建现有集群；缺点是 Kind 集群重建后模型副本会丢失。后续持久化方案改为 Kind `extraMounts`、PVC、NFS 或对象存储。

### 6.3 节点固定

只有保存模型的 Worker 节点需要标签：

```bash
kubectl label node <model-kind-worker> model-serving=true
```

Ray Worker 使用：

```yaml
nodeSelector:
  model-serving: "true"
```

容器内只读挂载：

```yaml
volumes:
  - name: models
    hostPath:
      path: /srv/models
      type: Directory
containers:
  - name: ray-worker
    volumeMounts:
      - name: models
        mountPath: /models
        readOnly: true
```

---

## 7. Runtime 与 RayService

### 7.1 Runtime 镜像

固定使用：

```text
110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
```

镜像必须在构建阶段包含以下内容；运行中不得执行 `pip install`、`apt install` 或下载模型：

- Python CPU Runtime。
- 固定版本的 Ray 与 Ray Serve。
- 固定版本的 CPU PyTorch 与 Transformers。
- 模型加载和 OpenAI-compatible API 服务代码。
- Health / readiness 所需依赖。

所有 KubeRay、Ray、PyTorch 与 Transformers 版本应先以一组兼容组合验证，再写入 Chart 和 Dockerfile；禁止使用 `latest`。

### 7.2 最小 OpenAI-compatible 契约

```text
GET  /v1/models
POST /v1/chat/completions
```

限制：

```text
仅 stream=false
不支持 tools / function calling
不支持 embeddings
不支持多模型动态加载
```

Runtime 环境变量：

```text
MODEL_ID=qwen2.5-coder-0.5b-instruct
MODEL_PATH=/models/qwen2.5-coder-0.5b-instruct
MODEL_REVISION=poc-v1
```

### 7.3 Ray Head 与 Worker

每个模型服务独立：

```text
1 ModelService
  -> 1 Helm Release
  -> 1 RayService
  -> 1 RayCluster
```

Head 只承载 Ray 控制面、Serve Controller 与 HTTP Proxy，不承载模型 Replica：

```yaml
headGroupSpec:
  rayStartParams:
    num-cpus: "0"
```

Worker 固定为一个 Replica，并固定资源边界：

```yaml
workerGroupSpecs:
  - groupName: model-workers
    replicas: 1
    template:
      spec:
        nodeSelector:
          model-serving: "true"
        containers:
          - name: ray-worker
            image: 110.120.0.3:8889/platform/ray-model-runtime:poc-cpu-v1
            resources:
              requests:
                cpu: "2"
                memory: 4Gi
              limits:
                cpu: "4"
                memory: 8Gi
```

CPU 推理仅用于低并发演示，不以延迟和吞吐为验收标准。

---

## 8. Gateway 与访问方式

### 8.1 路由规则

每个服务名派生 hostname：

```text
metadata.name: qwen-coder-poc
hostname:      qwen-coder-poc.models.poc
API base URL:  http://qwen-coder-poc.models.poc:30080/v1
```

Composition 通过 `platform-modelservice` Chart 创建 Host 匹配的 HTTPRoute，后端指向该 RayService 的 Serve Service。Chart 必须在实际安装的 KubeRay 版本上验证 Service 名称，而不是仅凭猜测硬编码。

### 8.2 客户端解析

POC 不依赖公网 DNS。需要访问模型 API 的客户端配置 hosts：

```text
110.120.0.3 qwen-coder-poc.models.poc
```

然后访问：

```text
http://qwen-coder-poc.models.poc:30080/v1/models
```

### 8.3 安全边界

POC 是受控内网 HTTP 演示环境：

```text
HTTP only
无 API Key
无 TLS
无模型专用限流和审计
```

当前 Envoy Gateway 只验证 Host 路由与后端转发。该入口不能作为生产 Coding Agent endpoint；生产阶段必须加入企业 DNS、HTTPS、认证、限流、日志和审计。

---

## 9. GitOps 与目录结构

每个模型实例使用一个小型 Helm Chart，仅渲染 `ModelService`：

```text
gitops/modelservices/qwen-coder-poc/
├── Chart.yaml
├── values.yaml
└── templates/
    └── modelservice.yaml
```

`values.yaml` 示例：

```yaml
model:
  id: qwen2.5-coder-0.5b-instruct
  revision: poc-v1
```

`modelservice.yaml` 示例：

```yaml
apiVersion: platform.example.com/v1alpha1
kind: ModelService
metadata:
  name: {{ .Release.Name }}
  namespace: models
spec:
  model:
    id: {{ .Values.model.id | quote }}
    revision: {{ .Values.model.revision | quote }}
```

对应的 Argo CD Application 只同步该实例目录，并开启 automated prune。GitOps 仓库不直接保存 `RayService`、RayCluster 或 HTTPRoute 实例。

---

## 10. Backstage 集成

### 10.1 第一阶段

第一阶段只注册 Catalog 实体，不改 Backstage 后端：

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: qwen-coder-poc
  description: CPU Ray Serve model service for platform POC
  annotations:
    backstage.io/kubernetes-id: qwen-coder-poc
    backstage.io/kubernetes-namespace: models
  links:
    - url: http://qwen-coder-poc.models.poc:30080/v1
      title: OpenAI API
      icon: web
spec:
  type: model-service
  lifecycle: experimental
  owner: platform-team
```

Backstage Catalog 使用现有 `Component`，不创建新的 Entity Kind。

### 10.2 第二阶段

第二阶段新增 `register-model-service` Scaffolder Template 与 `publish:gitea:pull-request` 自定义 Action：

```text
输入：modelServiceName、owner、固定模型选择
  -> 创建 onboarding 分支
  -> 生成 GitOps Chart、Argo Application 与 Catalog 文件
  -> commit / push
  -> Gitea API 创建或复用 Pull Request
  -> 返回 PR URL
```

Action 必须满足：

- 不在日志输出 Gitea Token。
- 分支与开放 PR 幂等。
- 仅允许平台允许的模型 ID。
- 不接受用户提交模型路径、Runtime 镜像或任意 hostname。

---

## 11. 分阶段实施

### 阶段 0：版本与依赖锁定

1. 选择并验证兼容的 KubeRay Operator、Ray CRD API、Ray、PyTorch 与 Transformers 版本。
2. 固定 Runtime Dockerfile 和 `poc-cpu-v1` 镜像标签。
3. 验证每个 Kind 节点都可从 `110.120.0.3:8889` 拉取 HTTP Registry 镜像。

### 阶段 1：模型与 Runtime 准备

1. 在可联网机器下载 `Qwen2.5-Coder-0.5B-Instruct`。
2. 生成并验证 SHA256 清单。
3. 传输到服务器 `/srv/models/qwen2.5-coder-0.5b-instruct`。
4. 复制到指定 Kind Worker 的同一路径。
5. 为该 Kind Worker 设置 `model-serving=true` 标签。
6. 构建并推送 Runtime 镜像到本地 Registry。

### 阶段 2：原始 RayService 验证

1. 安装共享 KubeRay Operator 与 CRD。
2. 手工提交一个原始 RayService。
3. 验证 Head、Worker、节点选择、只读模型挂载与 CPU 资源限制。
4. 验证 `/v1/models` 和非流式 `/v1/chat/completions`。
5. 记录已验证版本矩阵和 KubeRay Serve Service 名称。

### 阶段 3：Crossplane 与 Helm Chart

1. 创建 `ModelService` XRD 和 Composition。
2. Composition 使用现有 `provider-helm` 创建 Release。
3. 新增 `platform-modelservice` Chart，渲染 RayService 与 HTTPRoute。
4. 配置 Crossplane 对 Helm Release 的 RBAC。
5. 手工创建 ModelService，验证 Ready 状态与删除回收。

### 阶段 4：Argo CD 与 Gitea

1. 创建模型实例 GitOps Chart 和 Argo CD Application。
2. 通过手工 Gitea PR 合并实例定义。
3. 验证 Argo CD 创建 ModelService。
4. 删除 GitOps 实例，验证 automated prune 完整回收资源。

### 阶段 5：Backstage 自动化

1. 新增 `register-model-service` Template。
2. 实现并测试 Gitea PR Action。
3. 重新构建 Backstage 镜像并部署。
4. 验证 Portal 生成 PR、合并后部署和 Catalog 可观察性。

---

## 12. 验收标准

### 12.1 必须满足

- Runtime 镜像从 `110.120.0.3:8889` 拉取，运行时无公网依赖。
- 模型文件以只读方式挂载到固定 Kind Worker 的 `/models`。
- Worker 固定在 `model-serving=true` 节点，资源 requests/limits 生效。
- 一个 ModelService 只创建一个独立 RayService 和 RayCluster。
- Ray Serve 成功加载 Qwen 0.5B 模型。
- `GET /v1/models` 返回模型信息。
- `POST /v1/chat/completions` 在 `stream=false` 时返回真实推理结果。
- Host 路由可通过 `http://<service>.models.poc:30080/v1` 访问。
- Argo CD 创建和删除 ModelService 时，资源能自动创建和完整回收。
- Backstage Catalog 显示模型服务和 OpenAI API 链接。

### 12.2 第二阶段验收

- Backstage Template 能创建模型服务 onboarding 内容。
- Backstage 能在 Gitea 创建或复用 Pull Request。
- 合并 PR 后 Argo CD 自动部署模型服务。

---

## 13. 风险与后续演进

| 风险 | POC 处理 | 后续方案 |
|---|---|---|
| Kind 节点重建后模型丢失 | 重新 `docker cp` | `extraMounts`、PVC、NFS、对象存储 |
| CPU 推理性能低 | 只做低并发演示 | NPU Runtime、并发与资源调优 |
| HTTP 无认证 | 仅受控内网 | TLS、API Key、鉴权、限流、审计 |
| 单 Worker 无高可用 | POC 接受 | 多副本、自动扩缩容、故障转移 |
| 模型/Runtime 版本不兼容 | 固定并记录版本矩阵 | Runtime CI、兼容性测试 |
| Gateway 后端 Service 名称差异 | 阶段 2 实测后写入 Chart | 使用已验证的版本契约或动态引用 |

后续接入服务器 NPU 时，优先替换 Runtime 镜像、资源声明和节点调度逻辑；保持 `ModelService` API、GitOps 目录、Gitea/Argo CD 流程以及 Gateway API URL 不变。
