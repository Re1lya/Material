# Tekton / Argo CD / Recipe 发布边界（2026-08-19）

本文是本次继续工作的交接和发布说明。它把“已经在生产运行的控制链路”、
“本地已经完成但尚未发布的 Recipe 代码”和“不能在本次顺带打开的制品上传
功能”分开记录。

## 当前结论

### Tekton

生产 `model-platform-ci` 已有并验证：

- Gitea push / pull request EventListener；
- GitHub EventListener（HMAC + 同仓库/ref/action CEL 过滤）；
- 精确 commit checkout、catalog/schema/ModelDeployment 校验和 Gitea status；
- amd64、`server-00` nodeSelector、Artifact Keeper 固定 digest 的 CI tools；
- 仅作用于 `model-platform-ci` 的 event-based Pruner。

这条 CI 不创建 Deployment、XR、PVC、RayService 或 NPU Pod，也不触发 Argo
同步。无需为了“完成 Tekton”重新安装 Operator 或滚动现有控制器。

`tekton/artifact-publish/` 是另一个本地准备中的可选 lane。它会增加一个
`artifact-publish` namespace、一个内部 EventListener 和受限 Pipeline；当前
故意没有 staging PVC、publisher Secret 或 Backstage 配置，因此本次不应把它
误当作已生产启用的模型上传服务。

### Argo CD

生产已有两个受限的人工同步 Application：

| Application | Project | 允许对象 | 当前策略 |
|---|---|---|---|
| `model-platform-bootstrap` | `model-platform` | `model-platform-system` 中的 ConfigMap | 手工 Sync |
| `model-platform-deployment-requests` | `model-platform-control-plane` | `model-serving` 中的 `ModelDeployment` | 手工 Sync |

两个 Application 都没有 `spec.syncPolicy.automated`，没有 prune 和 self-heal。
这是当前安全边界，不能为本次 Recipe 发布打开自动 CD。尤其是第二个
Application 仍只接收已审查、默认 `desiredState: Stopped` 的请求。

### Recipe

本地源码已经连接到真实控制链路：

```text
Gitea ModelVersion/ModelRuntimeProfile
  -> Backstage /model-recipes 只读展示
  -> 后端重新读取并校验 Gitea catalog
  -> 只生成 desiredState=Stopped / control-plane-only 的 Gitea PR
  -> Tekton 校验 PR head SHA
  -> 人工合并
  -> 人工检查 Argo diff 并 Sync
  -> Crossplane 只生成控制面对象
```

但是当前生产仍运行 Backstage v0.2.11 digest；本地 Recipe 改动尚未重新构建、
发布和滚动生产 Deployment。因此，生产页面是否显示 live Gitea catalog 和
stopped deployment 状态，必须等新镜像发布后再验收，不能用本地测试结果代替。

## 本次允许的生产范围

本次只允许以下两类生产写操作：

1. 发布一个新的 AMD64 Backstage 镜像，并只更新 `backstage/backstage`
   Deployment 的 `image` 字段；
2. 如另行批准 artifact-publish lane，才创建其新 namespace、RBAC、Quota、
   NetworkPolicy、Pipeline、Trigger 和一个内部 EventListener。

本次明确禁止：

- 修改或重启现有 NPU/Ray/模型工作负载；
- 创建或扩容 ModelDeployment、XR、RayService、ModelCache Job 或 PVC；
- 修改 Crossplane、KubeRay、Argo Operator、Tekton Operator 的版本或 CRD；
- 打开 Argo automated sync、prune 或 self-heal；
- 使用浏览器或 Backstage 代理上传大型模型文件；
- 把 Artifact Keeper publisher/provision token 写入 Git、镜像、命令行参数或日志。

## 发布前本地验证

在 `Material/production/model-platform/backstage/app`：

```bash
corepack yarn tsc:full
corepack yarn workspace backend lint
corepack yarn workspace app lint
corepack yarn workspace backend build
corepack yarn workspace app build
corepack yarn workspace app test ArtifactManagementPage.test.tsx --runInBand
```

在仓库根目录：

```bash
git diff --check
grep -RInE 'REPLACE_WITH_|password:|token:|secretToken:' \
  production/model-platform/backstage production/model-platform/tekton/artifact-publish \
  --exclude-dir=node_modules --exclude-dir=dist
```

第二条只用于发现误提交的明文值；正常情况下允许配置中的环境变量名存在，
不允许出现真实值。

## Backstage Recipe 的生产发布顺序

### 1. 在有 Docker 权限的已确认 AMD64 构建主机上构建

构建主机必须先返回 `hostname`、`id -un` 和 Docker client/server 版本；不要
把“本地”“Docker 机器”当作主机名。构建上下文只包含 Backstage app，不包含
`.git`、`node_modules`、kubeconfig 或 Secret。

```bash
docker build --platform linux/amd64 \
  -f packages/backend/Dockerfile \
  -t 110.120.0.3:30670/container-images/model-platform-backstage:v0.2.12 .
docker push \
  110.120.0.3:30670/container-images/model-platform-backstage:v0.2.12
docker inspect --format='{{index .RepoDigests 0}}' \
  110.120.0.3:30670/container-images/model-platform-backstage:v0.2.12
regctl registry set --tls disabled 110.120.0.3:30670
regctl image inspect \
  110.120.0.3:30670/container-images/model-platform-backstage:v0.2.12 \
  --format '{{.OS}}/{{.Architecture}}'
```

返回的 digest 必须是 Artifact Keeper `container-images` 中的 immutable
digest，架构必须为 `linux/amd64`。拿到 digest 后，才把
`backstage/kubernetes/backstage.yaml` 的 image 改成
`v0.2.12@sha256:<digest>`。

### 2. server-00 只读基线和 server-side dry-run

```bash
sudo k3s kubectl config current-context
sudo k3s kubectl -n backstage get deployment backstage -o wide
sudo k3s kubectl -n backstage get pods -o wide
sudo k3s kubectl -n model-platform-ci get pods -o wide
sudo k3s kubectl get pods -A --field-selector=status.phase=Pending
sudo k3s kubectl apply --dry-run=server \
  -f backstage/kubernetes/backstage.yaml
```

只允许 dry-run 输出 `ServiceAccount/Service/Deployment`，且 Deployment 的
变更只应是镜像 digest。若出现其他 namespace、PVC、Secret、Ray、NPU、
Crossplane 或 Argo 对象，立即停止。

### 3. 生产写入和验收

得到用户对这个“仅 Backstage Deployment”变更的确认后：

```bash
sudo k3s kubectl apply -f backstage/kubernetes/backstage.yaml
sudo k3s kubectl -n backstage rollout status deployment/backstage --timeout=10m
curl -fsS http://110.120.0.3:30070/healthcheck
```

随后在 Backstage 页面验证：

- `/model-recipes` 的来源显示 live Gitea catalog（Gitea 不可达时才显示
  明确的 pinned fallback）；
- deployment status 仍为只读；
- 提交一次测试请求只生成 `Stopped/control-plane-only` PR；
- Tekton 对该 PR 的 policy status 成功；
- 不执行合并和 Argo Sync，除非用户另行批准；
- 发布前后 NPU/Ray Pod、CI Listener、Argo Pod 的数量和重启次数不变。

回滚只替换回上一版 Backstage immutable digest 并等待该 Deployment rollout；
不删除 PVC、Secret、Argo Application 或其他工作负载。

## artifact-publish lane 的后续门槛

这个 lane 不是 Recipe 上线的前置条件。只有在以下条件全部确认后才单独发布：

1. Backstage 有稳定 HTTPS；
2. `artifact-publish` namespace 中人工创建了 Artifact Keeper image-pull
   Secret 和 repository-scoped publisher Secret；
3. 明确 staging PVC 的容量、Retain 策略和数据清理规则；
4. 对应的 EventListener internal Service 已通过 NetworkPolicy 验证；
5. Backstage `artifactManagement` 配置显式启用，且 token 一次性显示仍受
   HTTPS 门禁保护。

大型模型仍应由受控 staging/Task Pod 读取并通过 Artifact Keeper resumable
   chunk API 上传，Backstage 只发送元数据和展示 PipelineRun，不应把几十 GiB
   文件经浏览器或 Backstage NodePort 转发。

## 生产证据要求

完成发布后，只记录以下非敏感证据：镜像 digest/架构、Deployment rollout、
`/healthcheck` 状态、Recipe live/fallback 状态、Tekton PipelineRun 名称和
结果、Argo Application 状态、NPU/Ray/CI Pod 数量前后对比。不得记录 Secret
内容、token、OIDC client secret、数据库密码或完整 kubeconfig。
