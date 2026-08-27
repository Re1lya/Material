# Backstage Recipe 与实际 ModelDeployment 链路接入记录

> 日期：2026-08-19
>
> 源码接入与本地构建/测试完成后，已于 2026-08-25 发布 Backstage v0.2.12。
> 发布只滚动更新了 `backstage` Deployment 镜像；没有创建或修改
> ModelDeployment、PVC、Job、RayService、Service 或 NPU 请求。

> 2026-08-25 后续 UI 更新：`/model-recipes` 已整理为两步体验
> “Choose a model to deploy → Deploy a model”。该更新通过页面单元测试、TypeScript
> 和 Backend build，并已作为 Backstage v0.2.13 发布；发布仍只滚动更新了
> Backstage Deployment。

## 接入结果

最新源码中的目录页只展示已注册且可部署的 Artifact Keeper 制品，并按模型、提供者或
量化方式搜索；选择模型后进入独立的配置视图。配置视图默认选中可 serving 的 TP2
RuntimeProfile，展示不可变制品路径、已验证的运行时契约和停止态资源摘要。切换
Serving recipe 会同时重置该 recipe 对应的物理卡位预览，避免不同 profile 的选择串用。
请求按钮仍只创建 `requestedReplicas: 0` 的停止态 PR，因此这次 UI 重整不会分配 NPU。

`/model-recipes` 已从固定 mock 目录调整为“真实目录优先、发布版本兜底”的只读页面：

```text
Gitea model-platform-config/main
  ├─ ModelVersion
  └─ ModelRuntimeProfile
          │
          ▼
Backstage GET /api/model-platform/catalog
          │
          ▼
Recipe 页面解析制品、镜像、缓存、节点和 Ray/NPU contract
          │
          ▼
受限 Scaffolder 模板
          │
          ▼
后端再次读取并校验 Gitea catalog
          │
          ▼
一个 desiredState=Stopped 的 ModelDeployment Gitea PR
          │
          ▼
Tekton → 人工合并 → Argo CD 手工 Sync → Crossplane
```

页面同时通过 `GET /api/model-platform/deployments` 读取 `model-serving` 命名空间的
只读状态：ModelDeployment、ConfigMap、PVC、Job、Deployment、Service 和 RayService。
该接口使用 Backstage ServiceAccount 的 namespace-scoped `get/list/watch` 权限，
不读取 Secret，也没有 Kubernetes 写权限。

## 重要的契约处理

- 前端只提交 `modelVersionRef`、`runtimeProfileRef` 和有界的 TP/PP/replica/priority
  意图；不提交镜像、hostPath、任意节点或 Kubernetes YAML。
- 后端 action 只接受 `app-config.yaml` 中的 model/profile allow-list，并再次读取
  Gitea `main` 的 ModelVersion/RuntimeProfile，检查兼容关系、Artifact Keeper
  manifest 和 Ray runtime/cache contract；页面展示的 profile nodeSelector 仍来自
  同一个已提交 RuntimeProfile。
- 生成的 PR 固定 `desiredState: Stopped`、`acceleratorPool: control-plane-only`、
  `compositionRef: modeldeployment-control-plane-v1alpha1`，并且**不写入物理
  nodeSelector**。这是 Tekton/XRD 的安全门：control-plane Composition 只记录
  申请，不允许通过停止态 PR 预选物理节点；未来切换 Running 时由人工评审单独补齐
  profile 的节点和 acceleratorPool。这样不会因为写入 PR 而调度 NPU。
- 成功创建 PR 后，action 只写入 Gitea pending status；Tekton、人工合并和 Argo CD
  仍是后续门禁，Backstage 不直接调用 Kubernetes、Crossplane 或 Ray。

## 本地验证

在 `production/model-platform/backstage/app` 执行：

```text
node .yarn/releases/yarn-4.13.0.cjs tsc --noEmit
node .yarn/releases/yarn-4.13.0.cjs workspace app test ModelDeploymentRecipesPage.test.tsx --runInBand
node .yarn/releases/yarn-4.13.0.cjs workspace backend build
```

验证结果：TypeScript、2 个 Recipe 页面测试和 Backend build 均通过。测试中仍会显示
Material UI 的既有 `findDOMNode` 弃用警告；它不影响结果，也不是本次接入引入的运行时
错误。

## 发布边界

生产已运行 Backstage v0.2.13：
`110.120.0.3:30670/container-images/model-platform-backstage:v0.2.13@sha256:a15b8ed3b01acb356a4cf651bb914565c87cacb76b28a403ad14b347b2aa6306`。
发布前的 server-side dry-run 显示 ServiceAccount、Service 不变，仅 Deployment
配置；滚动更新后 Pod `1/1 Ready`、门户 HTTP 200、无新增 Pending Pod，且容器没有
NPU 资源声明。浏览器登录和 `/model-recipes` 真实页面流仍需单独验收。Argo
`prune/self-heal` 继续关闭，Backstage ServiceAccount 的只读 RBAC 未扩大。
