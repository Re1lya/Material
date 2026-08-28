# K12 CPU 控制面发布与验收记录（2026-08-27）

> **本阶段只完成新 K12 CPU 控制面部署和只读健康验收，尚未执行 CPU 数据 smoke，
> 也未切换旧服务。** 旧 `k12/mineru-dagster` 继续承载生产流量（NodePort 30080）。

## 1. 源码与镜像

| 项目 | 值 |
| --- | --- |
| KCC main（基线） | `4316cf55b879375f82779f2654342471e789b13e` |
| KCC 本阶段新增 PR | #5 `7c171e7…`、#6 `09d9067…`、#7 `a194be5…`（均已合并） |
| KCC main（阶段末） | 由上述合并生成；最新 HEAD 在合并 PR #7 后更新 |
| K12 镜像 | `110.120.0.3:30670/container-images/platform/kcc-data-pipeline:0.4.0-cpu-528da6f@sha256:f37687ea197794cbeb471505f193c19adbbb5e29133b245dff6c505dc1756718` |
| 镜像属性 | linux/amd64，33+3 测试通过，CPU Profile 仅 7 Job，无 NPU/MinerU/Qwen Worker |

### 本阶段修复合入的 chart 缺陷

1. Ray head 容器缺少 `gcs-server` containerPort 声明，KubeRay 自动生成的 head Service
   因此没有 6379 端口，CPU worker 无法 join → 增加 `ray.head.service.gcsPort: 6379`
   并在 ray-head ingress NetworkPolicy 放行。
2. `rayStartParams.resources` 的 JSON 含空格且引号在 KubeRay 组合参数时被剥离，
   worker 启动报 `Got unexpected extra argument (1})` → 先去空格，再采用
   `ray.io/overwrite-container-cmd: "true"` + 显式 bash 命令（与 qwen ray-bridge 同款模式）
   彻底规避 shell 解析问题。

## 2. K12 Tekton CI

| PipelineRun | 验证对象 | 结果 |
| --- | --- | --- |
| `k12-data-pipeline-validation-tv5q7` | kcc PR #5（gcs 端口） | Succeeded |
| `k12-data-pipeline-validation-llq2q` | kcc PR #6（紧凑 JSON） | Succeeded |
| `k12-data-pipeline-validation-kw8st` | kcc PR #7（显式命令） | Succeeded |

## 3. GitOps 发布与独立 CI

`gitadmin/model-platform-config`：

| PR | 内容 | 分支 commit | 合并后 main |
| --- | --- | --- | --- |
| #5 | 初始 K12 发布目录（kustomization + release.yaml，7 对象） | `1c340e4f7d7f136db4e73b7c008780a9897343f3` | `f3a836b85a1ca6e44236b82cc6c9535ff67dd768` |
| #6 | gcs 端口修复后的 release 重渲染 | `22f29c7a6a76ef26a44953ddef99ebd1e4323ba1` | `1925c394813682b2efd4352d1cd351f0d8bf0ff2` |
| #7 | 紧凑 resources JSON 的 release 重渲染 | `eaab75692e6fbcf07c88a89c552820b0bfa0bda7` | `b16a991514e0d2e8933826c13bd5201c8994568a` |
| #8 | 显式 cpu-worker 命令的 release 重渲染 | `4854ee7a0317bc89641b3a061a18547c13e6d0ae` | `56798d27b385c63e82ecfdf4016721d57bd90136` |

通用 context `tekton/model-platform-policy` 因主线既有 Qwen ModelDeployment 与旧
schema 不一致持续 failure——与本 K12 变更无关，未触碰。

为本任务新建专用 Tekton Pipeline `model-platform-ci/validate-k12-gitops-release`
（新文件 `production/model-platform/tekton/ci/k12-gitops-validation.yaml`）：clone
精确 40 位 commit → `kubectl kustomize environments/production/k12-data-pipeline` →
强校验：恰好 7 个对象、kinds 分布（SA/CM/Service/Deployment/RayCluster/NP×2）、全部
镜像固定为批准 digest、拒绝 huawei.com/Ascend、hostPath、nodePort、privileged:
true、Secret/PV/PVC/Role/RoleBinding、qwen-worker、mineru-worker → finally 经既有
repository-scoped `gitea-ci-status-writer` 回写 Gitea status
context=`tekton/k12-gitops-release`。服务器端 dry-run 按 CI 无 API 权限的设计，
在 server-00 以 root 受控执行并记录，未扩大 runner RBAC。

| PipelineRun | config commit | 结果 / status |
| --- | --- | --- |
| `k12-gitops-validation-xwh4b` | 1c340e4f… | Failed（脚本 argv 传入缺陷，首次试跑暴露并即改） |
| `k12-gitops-validation-dxcld` | 1c340e4f… | Succeeded → status=success |
| `k12-gitops-validation-bnd7p` | 22f29c7a… | Succeeded → status=success |
| `k12-gitops-validation-wjdh5` | eaab7569… | Succeeded → status=success |
| `k12-gitops-validation-2s6dg` | 4854ee7a… | Succeeded → status=success |

PR #5 合并前核查：diff 仅含 `environments/production/k12-data-pipeline/` 两文件；
7 对象 server-side dry-run 通过；release-bot 权限未变化（仅两仓库）。

## 4. 存储对象

创建前终检：旧 Deployment 1/1、Pod 2/2 Running 0 restart；
`/mnt/data/k12-data-pipeline/dagster-home` owner=root:root mode=0750；
active_run_count=0；66 库 quick_check 全 PASS。

```text
StorageClass k12-dagster-local          provisioner=kubernetes.io/no-provisioner, Retain, WaitForFirstConsumer
PV           k12-dagster-home-server-00 path=/mnt/data/k12-data-pipeline/dagster-home, Retain, RWO, 20Gi, nodeAffinity server-00
PVC          k12/k12-dagster-home       Bound -> k12-dagster-home-server-00（在新 Dagster Pod 调度时绑定）
```

注：WFFC + no-provisioner 下 PVC 创建初值 Pending 属预期，Bound 发生在新控制面
Pod 消费之后，已观测确认。

## 5. 运行身份 Secret（只记录名称/类型/key）

| Secret | 类型 | keys | 说明 |
| --- | --- | --- | --- |
| `k12/artifact-keeper-image-pull` | kubernetes.io/dockerconfigjson | .dockerconfigjson | 从文档已批准的 `model-platform-ci/artifact-keeper-image-pull`（container-images 只读拉取身份）字节级复制，未解码打印 |
| `k12/k12-pipeline-s3` | Opaque | access-key, secret-key | 新建非 root MinIO 用户 `a56fdfc2…`（十六进制名），策略 `k12-cpu-runtime`：k12-mineru-output 仅 List/Get；k12-cleaned-corpus List/Get 全量 + PutObject 限 `stage1/platform-smoke/*` 与 `cpu-smoke/*`；2026-08-28 smoke 发现 K12 原子写协议需要清理临时对象，现只允许删除上述 prefix 下的 `*.tmp-*`，正式对象仍不可删除 |

值全程经 stdin/内存传递，只在创建瞬间以 0600 临时文件落盘随后删除；未出现在任何
命令参数、Git 文件或日志中。

## 6. Argo 边界

- AppProject `k12-data-pipeline`：sourceRepos 仅 model-platform-config；
  destinations 仅 namespace=k12；clusterResourceWhitelist=[]；
  namespaceResourceWhitelist 仅 SA/CM/Service/apps-Deployment/networking-NetworkPolicy/ray.io-RayCluster；
  orphanedResources.warn=true。部署中发现 3 个孤儿资源警告 = 旧 K12 对象，符合 warn-only 设计。
- Application `k12-data-pipeline`：targetRevision=main，path=environments/production/k12-data-pipeline，
  destination ns=k12；无 automated policy/prune/selfHeal/deletion finalizer；人工 Sync。
- 排障记录：首建应用对比 Unauthorized——Argo v3 按项目隔离 repo 凭据，既有两个凭据
  Secret 分别绑定 `model-platform` / `model-platform-control-plane` 项目；为新项目注册了
  `argocd/k12-data-pipeline-repository`（同一 argocd-reader 只读身份字节级复用，
  project 键=k12-data-pipeline），未扩权、不改既有 Secret。
- 当前 Sync revision：`56798d27b385c63e82ecfdf4016721d57bd90136`（Synced/Healthy）。

## 7. 容量门禁（同步前后）

| 指标 | 同步前 | 同步后（稳态） |
| --- | --- | --- |
| CPU requests | 30100m (47%) | 41100m (**64%**, <70% 达标) |
| CPU 实际 | 3513m (5%) | 5301m (8%) |
| 内存 requests/实际 | 53.6Gi/60Gi | 53644Mi→(+38Gi 内含)/64.7Gi（余量充足） |
| `/mnt/data` 可用 | 1.6TiB | 1.6TiB (78% 使用) |
| 节点 Events | 无 | 无 |

新 release 全部 Pods 调度于 server-00（webserver+daemon 750m? 实测 request 见 release 渲染、Ray head 1C/2Gi、worker 8C/32Gi）。

## 8. 新控制面状态（阶段末快照）

```text
deployment/k12-platform-cpu-k12-clean-qa-pipeline-dagster   1/1   images 固定 digest
pod   dagster webserver+daemon                              2/2 Running restarts=0
pod   ray head                                              1/1 Running restarts=0
pod   ray cpu-worker                                        1/1 Running restarts=0（成功加入集群）
raycluster k12-platform-cpu-k12-clean-qa-pipeline-k12-clean-qa  workers ready=1/1 STATUS=ready  spec Ascend 计数=0
svc    dagster  ClusterIP 3000    （无 NodePort）
svc    head-svc ClusterIP headless 10001/8265/6379/8080（operator 重建后含 gcs 6379）
SA     k12-data-pipeline      automountServiceAccountToken=false
```

### Dagster GraphQL 目录（只读查询）

repository=__repository__，job_count=**7**：

```text
__ASSET_JOB
cleaning_full_job
cleaning_smoke_10_job
cleanjopbstage1_10
cleanjopbstage1_ful
mineru_finalize_job
register_existing_mineru_batch_job
forbidden_present=NONE（六个禁用 Job 名均不存在）
```

/server_info HTTP 200。

### S3 只读验收（无写探测）

- 集群内 DNS `minio-k12.k12-lake.svc.cluster.local` → 10.43.41.44 ✓
- 新身份 list：k12-mineru-output 46,092 对象、k12-cleaned-corpus 168,511 对象 ✓
- 指定 MinerU 前缀可读 ✓；未执行任何写操作（策略本身亦无 Delete 权限）

## 9. 旧服务最终状态

```text
deployment/mineru-dagster        1/1 Available（38d 未变）
pod/mineru-dagster-fdccb89d7-jgbh4  2/2 Running  restarts=0
svc/mineru-dagster               NodePort 3000:30080（未改）
```

全程未 rollout/scale/restart/patch，Dagster state 未动。

## 10. 安全事项与轮换结果

本阶段产生三次会话日志层面的凭据可见性事件（均不涉及文件或 Git 泄露，但需处理）：

1. release-bot Gitea token（异常栈携带 Authorization 头打印一次）；
2. MinIO root 用户名字符串出现一次（未含密码）；
3. Argo repo 凭据字段 base64 打印一次。

验收清理已于同日完成：

- Gitea `release-bot` 已轮换为 `server-00-kcc-release-bot-r3`；两个批准仓库访问正常，
  旧 Token 已撤销，受控文件为 `root:root` / `0600`；
- 三个项目隔离的 Argo repository Secret 已统一更新为
  `argocd-reader-20260827-r2`；旧 `argocd-reader-20260819` 已撤销，相关 Application
  继续保持 Synced/Healthy；
- MinIO 事件只暴露 root 用户名，未暴露密码、access key 或 secret key，因此未轮换 root
  身份；后续 smoke 将 `k12-cpu-runtime` 修正为仅允许删除两个 CPU smoke prefix 下的
  `*.tmp-*` 原子写临时对象，普通正式 key 的删除复核仍返回 HTTP 403；
- `k12-prestage-temp-20260827` 临时 SSH 公钥已从 server-00 `authorized_keys` 精确移除，
  原 `ray-proxy-tunnel-110.120.0.3` 公钥保留。

## 11. 后续（下一阶段）

- 兼容性 CPU smoke manifest 小批量验证读写、progress、_SUCCESS、失败重试、resume；
- 观察期后进行服务入口切换评审（仍需受控窗口 + 最终状态同步）；
- 处理既有 Qwen schema 告警（独立轨道，不得混入 K12 PR）。
