# 模型集成平台当前状态（2026-09-17）

> 本文是对生产 `server-00` 的定向实时核验快照，重点是 K12 CPU 数据清洗主线和
> Backstage 接入。它更新并优先于 `CURRENT-STATE-20260905.md` 中的“当前事实”表述；
> 后者关于推理 v2 的历史证据仍然有效。本文不包含密码、Token、Secret data、
> kubeconfig 或 Docker config 内容。

## 0. 2026-09-18 更新（MinerU 失败 → autoscale16 收敛 → 最终 NPU 全链路成功）

- 凌晨首次受控 MinerU NPU 启动因静态 `MINERU_PHYSICAL_DEVICES=14,15` 与
  Volcano/MindX 实际分配 `Ascend910-12,13` 不一致而失败；PR #59
  （merge `face37dbe`）将声明态回到 0 副本，未发起 smoke。
- 随后完成 autoscale16 r9 收敛：config PR #60/#61 + AppProject 最小 RBAC 扩权，
  Argo `k12-data-pipeline` 为 `Synced/Healthy`，revision
  `feac76fa71281b28e6a4ba9060dd7958d81d2904`，23/23 资源同步。
- 最终完整链路 NPU 测试成功：run `bd5388b4-3537-4434-b082-049be04427af`，
  10/10 文档、QA+MCQ schema-valid-unjudged，Dagster 139 步成功 0 失败；
  测试后全部 worker=0、Lease 释放、A3 无残留进程。
- 证据与门禁见 `data-pipeline/k12-r9-convergence-and-final-npu-run-record-20260918.md`
  与 `data-pipeline/k12-mineru-device-mismatch-stop-record-20260918.md`。

## 1. 结论

K12 CPU 数据管线的主线已经可用：Backstage 的受限数据管线页面经其后端直接调用
Dagster GraphQL 启动清洗任务，Dagster 使用 CPU Ray 执行并将结果写到受约束的 MinIO
前缀。**单次清洗不通过 GitOps 创建资源**；GitOps 只用于变更管线代码镜像、Dagster/
Ray 配置和受版本控制的运行环境。

2026-09-17 已在用户确认后执行一次无 prune 的 Argo CD 手动同步，消除了 K12
Dagster 运行镜像与 Gitea 期望态之间的漂移。同步后 `k12-data-pipeline` 为
`Synced/Healthy`，Dagster、CPU Ray head 和一个 CPU worker 全部 Ready。MinerU/Qwen
NPU Deployment 继续为零副本，未启动 NPU 工作负载。

这意味着“从 Backstage 发起受控的 10 文档 CPU Stage 1 清洗，并由系统跑完”的基础
路径可用；它不是任意参数、任意 Bucket 或 NPU 的通用任务编排器。一次已完成的真实
Backstage 会话验收和一次较新的 CPU 作业成功记录都存在，见第 3 节。此次同步后尚未用
新的登录会话再次点击 Launch，因此不把它写成一次新的 UI 端到端验收。

## 2. 2026-09-17 生产核验

| 项目 | 观察到的生产事实 | 结论 |
| --- | --- | --- |
| Argo CD Application | `k12-data-pipeline`：`Synced/Healthy`，revision `a78efeadc9ca285b58a78611789605625f59c70e`，最近操作 `Succeeded` | K12 GitOps 期望态已收敛；自动同步、prune 和 self-heal 仍未开启。 |
| Dagster 控制面 | Deployment `k12-platform-cpu-k12-clean-qa-pipeline-dagster` generation `11/11`、`1/1 Ready`，镜像为 `kcc-data-pipeline:0.5.1-npu-smoke-3b51c26` 的不可变 digest | 可接受任务；Pod 中 GraphQL 查询正常返回。 |
| CPU 运行时 | RayCluster `ready`，desired/available/ready worker 均为 `1`；head 和 worker 均 Running | CPU 执行容量在线。 |
| NPU 工作负载 | `k12-platform-cpu-k12-clean-qa-pipeline-mineru` 与 `...-qwen` 的期望副本均为 `0`；旧 `mineru-dagster` 亦为 `0` | 本次未扩展到 NPU，符合主线范围。 |
| Backstage | 生产 Backstage 为 `kcc-backstage:0.6.20-direct-ui-f8a1648-r2` 的不可变 digest，Deployment `1/1 Ready`；已验证 `/data-pipeline` 返回 HTTP 200 | UI 和后端仍在运行；需已登录的允许发起者才能点击启动。 |

本次同步的目标是回到 Gitea `model-platform-config` 的已审阅 0.5.1 digest，而不是把
运行中的 0.5.2 asset-demo 临时镜像继续当作期望态。服务器端 dry-run 已覆盖该 release
的 12 个对象；实际同步后只发生受控的 Dagster 回滚/滚动更新。asset demo 文件与 Stage 1
核心清洗逻辑无差异，因而不影响此主线。

## 3. Backstage 到清洗任务的实际链路

```text
管线定义、镜像或运行环境变更
  Gitea -> Tekton 校验 -> GitOps 合并 -> 人工 Argo CD 同步

单次清洗请求
  已登录 Backstage 用户 -> /api/data-pipeline -> Dagster GraphQL launchRun
  -> CPU Ray -> MinIO 输入/输出 -> Backstage 查询 Dagster run 状态
```

当前 Backstage 后端在启动前确认三项就绪状态：K12 Dagster Deployment、CPU RayCluster 和
Dagster API。它只允许受配置约束的 `cleanjopbstage1_10` / `k12-stage1-clean-v1` 组合，
只接受 `k12-cleaned-corpus/cpu-smoke/manifests/` 下的 manifest；输入 Bucket/Prefix、输出
Bucket 及 CPU 并发均使用服务端配置。每个请求会得到隔离的
`stage1/platform-smoke/<request-name>` 输出前缀，且 `npu_enabled=false`。这既避免通过
Backstage 任意写 MinIO，也不创建 Kubernetes Job 或直接改 GitOps。

已有验收和作业证据如下：

- 2026-08-28，允许发起者 `user:default/gitadmin` 从真实 Backstage 会话启动
  `backstage-stage1-sample`，Dagster run
  `51e7a011-2fb3-48e4-bd80-f3f875c82fd6` 在约 50 秒后 `SUCCESS`。
- 2026-09-14，当前主线 `cleanjopbstage1_10` 以同一受控 CPU 配置完成 run
  `34ab2361-4a73-4d97-9d28-fe5af5415288`，耗时约 45 秒。这证明当前输入/输出前缀与
  CPU Ray 仍可完成技术执行；该 run 不带 Backstage 请求标签，不能替代新的 UI 验收。
- 2026-09-16 的 run `4f06f168-b487-4f98-bdf9-2386cd359724` 失败，是因为 Dagster UI
  使用了不在允许范围内的输出/selection manifest 前缀，MinIO 正确拒绝 `PutObject`。
  它不是 Backstage 受控路径或此次 0.5.1 同步导致的失败。

## 4. 主线完成度与剩余 stage

| Stage | 状态 | 下一步 |
| --- | --- | --- |
| GitOps 运行环境 | 已完成 | 后续镜像/配置变更继续走 Gitea、校验和手动同步。 |
| Dagster + CPU Ray 执行面 | 已完成 | 维持一个 worker 的当前基线；按容量需要再单独评审扩缩。 |
| Backstage 受控启动与状态查询 | 已完成历史验收，待本次同步后的复验 | 使用允许发起者登录，提交一个新的唯一 request name，并确认 Success、零 active runs 和目标 MinIO 前缀。 |
| 清洗结果质量自动验收 | 未完成 | 当前 Backstage 请求固定 `automated_validation=false`；需要定义质量阈值、产物 manifest/checks 和失败回写，才能把“任务成功”提升为“数据可发布”。 |
| 通用参数化/多 profile/NPU | 未开始 | 保持独立阶段；不得以当前 CPU 页面启动 MinerU、Qwen 或任意 Kubernetes 工作负载。 |
| 用户级授权、审计告警 | 暂缓 | 非本次主线阻塞项；现有允许发起者检查继续保留，不新增权限面。 |

## 5. 下一次最小验收

1. 用允许的 Backstage 身份打开 `/data-pipeline`，确认三项 readiness 均为 Ready。
2. 使用 `cpu-smoke/manifests/` 下的允许 manifest 和新的 DNS-safe request name 发起
   10 文档运行；不修改 GitOps、Bucket 或 NPU 参数。
3. 观察 Backstage/Dagster 状态到 `SUCCESS`，确认没有 active run，并仅检查对应的
   `stage1/platform-smoke/<request-name>` 结果前缀。
4. 将该 run ID、输入 manifest、输出前缀、时长和结果检查写入发布记录；之后再决定
   是否把质量自动验证作为下一主线。

如需恢复到同步前的 0.5.2 asset-demo 临时镜像，必须先在 Gitea 将对应完整源码和不可变
digest 纳入审阅期望态，再执行同样的 dry-run 和人工同步；不应直接 patch 生产 Deployment。
