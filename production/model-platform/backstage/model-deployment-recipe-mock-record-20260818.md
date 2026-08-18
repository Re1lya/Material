# Backstage 模型发布与部署入口调整记录

> 日期：2026-08-18
>
> 范围：Backstage 前端交互、受限 Gitea Scaffolder Action 和页面契约；本次没有下载
> 模型、创建 Ray/Kubernetes 对象或触碰 NPU。

## 调整结果

| 页面 | 路由 | 新职责 | 写操作 |
| --- | --- | --- | --- |
| KCC Pretraining | `/kcc-pretraining` | 展示 ModelScope → CPU importer → Artifact Keeper → ModelVersion 的发布门禁 | 无；预训练/量化仍由隔离构建任务执行 |
| Model Deployment | `/model-recipes` | 展示已提交的 ModelVersion/RuntimeProfile 快照和解析后的停止态部署契约 | 跳转到 Backstage Scaffolder，由后端创建受限 Gitea PR |

部署页面不再生成浏览器内的 mock 成功结果。按钮只进入
`request-model-deployment` 模板，后端动作会：

1. 校验当前身份、ModelVersion、RuntimeProfile 和 DNS 名称白名单；
2. 在固定 Gitea 仓库中写入 `ModelDeployment` 文件，强制
   `desiredState: Stopped` 和 `placement.acceleratorPool: control-plane-only`；
3. 创建 PR 并发布等待 Tekton 的 pending status；
4. 等待 Tekton 成功、人审合并和人工 Argo CD Sync，之后才由 Crossplane 负责组合资源。

Gitea 在这里是 GitOps 期望状态、PR 审查和审计记录，不是 Kubernetes/Ray 执行器；
OIDC 登录只是身份来源。页面不会直接调用 Kubernetes、Ray、Crossplane 或 NPU API。

## 当前可见目录

页面继续展示已提交的 `qwen3.6-27b-w8a8-20260806` 快照，字段来自仓库中的
`ModelVersion` 和 `ModelRuntimeProfile`。Qwen3.8 W8A8 只有模板，未生成正式
ModelVersion、Artifact Keeper manifest 或可部署 RuntimeProfile，因此不会被伪造为
可部署模型。

## Provider 基础设施边界

Crossplane foundation 已应用，但 `provider-kubernetes` package、ProviderConfig、
PVC、cache Job、RayService 和 Service 仍未创建。Provider 包必须先通过
`crossplane/provider-kubernetes/mirror-package.sh` 校验并镜像到 Artifact Keeper，
然后记录内部不可变 digest，再进行生成 RBAC 审计和安装。

镜像代理（例如 dockerproxy）只能作为构建主机的传输层；生产 Provider 清单只能引用
Artifact Keeper 内部 HTTPS 地址和 digest。

## 本地验证

- TypeScript/Backstage 页面测试需通过后再构建镜像；
- YAML/JSON schema、`git diff --check` 和 Provider mirror shell 语法检查；
- 不执行 `mirror-package.sh`，不读取 Artifact Keeper writer Secret；
- 不对 `gpu-server-00`、NPU 或现有运行程序做任何变更。
