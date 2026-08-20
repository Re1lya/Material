# Backstage Recipe 与实际 ModelDeployment 链路接入记录

> 日期：2026-08-19
>
> 本次只修改仓库源码和文档并做本地构建/测试；没有发布新 Backstage 镜像，
> 没有创建或修改 ModelDeployment、PVC、Job、RayService、Service、Pod 或 NPU 请求。

## 接入结果

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

当前生产 Pod 仍运行已发布的 Backstage v0.2.11 digest。源码接入完成后，后续若要
让生产页面读取这些 API，需要单独执行 Backstage AMD64 镜像构建、Artifact Keeper
不可变 digest 校验、server-00 仅限 Deployment 的 dry-run/滚动发布和页面验收。
该发布不会触碰 NPU，但仍应保持人工审批、Argo `prune/self-heal` 关闭，并在发布前
确认 Backstage ServiceAccount 的只读 RBAC 未扩大。
