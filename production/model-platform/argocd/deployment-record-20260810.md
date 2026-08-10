# Argo CD 生产部署与验收记录

> 部署日期：2026-08-10
>
> 目标：在 `server-00` 的生产 K3s 中建立最小、私有、无 NPU 的 GitOps 控制面，
> 但暂不授予任何仓库或集群资源同步权限。

## 1. 部署结果

| 项目 | 结果 |
|---|---|
| Namespace | `argocd` |
| Helm release | `argocd`，revision 1，`deployed` |
| Helm chart | `argo-cd-10.1.4` |
| Argo CD | `v3.4.5` |
| 节点 | 所有运行 Pod 固定在 `server-00` |
| 对外暴露 | 仅 ClusterIP，无 Ingress、NodePort、Gateway 或 LoadBalancer |
| 持久化 | 无 PVC；Redis 仅作可丢弃缓存 |
| NPU | 无 NPU request，也没有创建推理或缓存工作负载 |

生产运行组件：

- `argocd-application-controller`：1 个 StatefulSet Pod。
- `argocd-repo-server`：1 个 Deployment Pod。
- `argocd-server`：1 个 Deployment Pod。
- `argocd-redis`：1 个 Deployment Pod。

Dex、Notifications、Commit Server、Redis HA 和 Redis Exporter 均未启用。
ApplicationSet Deployment 因 chart 兼容性保留，但副本数固定为 0。

## 2. 供应链和部署前审查

使用官方 Helm release 中的 chart 压缩包：

```text
argo-cd-10.1.4.tgz
sha256: 142d2eaaa2adf9051c109c396c5fe3af742674011a5837df262bd6f8f2991d2c
```

运行镜像先按 `linux/amd64` 复制到现有内部 Registry，并核对目标摘要与源摘要：

| 镜像 | 固定摘要 |
|---|---|
| `110.120.0.3:8889/platform/argocd:v3.4.5` | `sha256:bd9ef458249f5d7778d906a4d77bcfa61b85d69a0efc8e802cd02f35eb63dede` |
| `110.120.0.3:8889/library/redis:8.2.3-alpine` | `sha256:e499175dfb27569cd40010c2eee346113db95fdd0efc88ab9fd70a9e807f4542` |

`values-production.yaml` 使用 `tag@digest`，运行时不会因相同 tag 被移动而静默替换
镜像。

Helm lint、template 和 K3s API server 端 Helm dry-run 均通过。渲染结果包含 Argo
CD 所需的 3 个 CRD、控制器 RBAC、4 个运行组件以及 3 个 ServiceMonitor，不包含
Application、PVC 或任何外部入口。

控制器 ClusterRole 具有管理 Kubernetes 资源所需的宽权限。这是 GitOps 控制面的
主要风险，因此本阶段没有配置仓库凭据或 Application，并额外锁死自动生成的
`default` AppProject。

## 3. 资源预算

稳定运行组件的资源边界：

| 组件 | CPU request / limit | 内存 request / limit |
|---|---:|---:|
| Application Controller | 250m / 1 | 512Mi / 1Gi |
| Repo Server | 200m / 1 | 256Mi / 1Gi |
| API/UI Server | 100m / 500m | 128Mi / 512Mi |
| Redis | 50m / 500m | 128Mi / 512Mi |
| 合计 | 600m / 3 | 1Gi / 3Gi |

一次空闲观测约为 14m CPU 和 84Mi 内存。该观测不替代 requests、limits 或长期
监控。部署后 `server-00` 整体 requests 约为 48.5 CPU（75%）和 128396Mi 内存
（16%）；CPU 仍然是下一模块的主要约束。

## 4. 权限门禁

Argo CD 首次启动会自动创建权限宽泛的 `default` AppProject。本次部署后立即应用
`default-project-lockdown.yaml`，当前配置为：

- `sourceRepos: []`
- `destinations: []`
- cluster 和 namespace 资源均无允许项，并配置全量 blacklist。

集群中当前没有 Application 或 ApplicationSet。因此 Argo CD 虽已运行，但不能从
任何 Git 仓库向任何 namespace 同步、删除或自愈资源。

后续必须新建专用 AppProject，并显式限制：

1. 唯一允许的 Gitea 仓库 URL。
2. 唯一允许的目标 namespace。
3. 允许的资源种类。
4. 首次只启用人工同步，不启用 automated、prune 或 self-heal。

## 5. 运行验收

验收结果：

- Helm release 为 `deployed`，四个运行 Pod 均 `Ready`、0 次重启。
- ApplicationSet Deployment 的期望副本数为 0。
- Pod `imageID` 与审查通过的两个摘要完全一致。
- `argocd-server` 的 `/healthz` 返回 `ok`。
- namespace 中无 Warning Event。
- Controller、Repo Server 和 Server 日志无 error、panic 或 fatal。
- Redis 已正常监听并接受连接。
- 3 个 Prometheus target 均为 `up`：Controller、Repo Server、Server。
- 使用一次性 BusyBox Pod 从 `argocd` namespace 访问
  `gitea-http.gitea.svc.cluster.local:3000/api/healthz`，Gitea、数据库和缓存检查均
  通过；测试 Pod 随后自动删除。
- Gitea 和 Artifact Keeper 的现有 Pod 在部署后仍为 `Ready`、0 次重启。
- 没有创建 NPU request，没有执行模型缓存或推理测试。

## 6. 运维边界

`argocd-server` 当前只提供 ClusterIP。需要访问 UI 时使用临时端口转发：

```bash
sudo k3s kubectl -n argocd port-forward service/argocd-server 8443:443
```

初始管理员密码保留在集群 Secret 中，没有读取或写入 Git。首次真实登录时应即时
取用、立即修改，随后评估禁用内置 admin 并接入统一身份。

生产命令必须显式使用 `sudo k3s kubectl` 或
`--kubeconfig /etc/rancher/k3s/k3s.yaml`。`server-00` 上的普通 `kubectl` 当前指向
旧 Kind POC，不能用于本生产 release。

## 7. 下一门禁

下一步不是直接让 Argo CD 管理整个集群，而是：

1. 将经过审查的平台配置写入 Gitea 的 `model-platform-config` 仓库。
2. 创建 repository-scoped 的只读机器凭据，并以 Secret 注入 Argo CD。
3. 创建独立的最小权限 AppProject。
4. 创建第一个仅管理无 NPU、低风险对象的 Application。
5. 人工执行首次 sync，验证 diff、健康、回滚和监控后，再考虑自动同步。

## 8. 后续最小闭环状态

上述门禁中的最小连接已于同日完成。生产增加了专用只读机器人、仓库 Secret、
`model-platform` AppProject 和 `model-platform-bootstrap` Application，并只人工同步
了一个隔离 ConfigMap。`default` AppProject 仍保持锁定，自动同步、prune 和
self-heal 仍未启用。详细证据见
`../gitops/deployment-record-20260810.md`。
