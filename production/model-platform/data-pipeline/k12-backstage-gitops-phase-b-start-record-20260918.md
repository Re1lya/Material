# K12 Backstage / GitOps 集成 B 阶段启动记录 — 2026-09-18

> 记录类型：本地集成开发状态与发布门禁。本文不表示生产功能已启用，且不包含密码、Token、Secret data 或 kubeconfig。
>
> 前置验收：`k12-r9-convergence-and-final-npu-run-record-20260918.md`。

## 1. 结论

- 数据管线 **NPU 主链路** 已有生产验收：真实 PDF → MinerU → Stage 1 → Qwen QA 的 10/10 文档与 304/304 请求成功；运行后 worker 缩至零、A3 无 NPU 进程，Argo 为 `Synced/Healthy` revision `feac76fa71281b28e6a4ba9060dd7958d81d2904`。
- 这不等同于 PR #2 全能力完成。8 NPU Qwen profile、2 NPU lifecycle/chat、MinerU submit/finalize/registration、兼容 profile、assets/demo、训练 JSONL/质量门槛与失败/重试/并发回归仍由后续独立复验覆盖。
- Backstage / GitOps B 阶段现已开始本地开发，但**未部署、未开启任何 NPU 入口，也未创建生产 GitOps 请求**。

## 2. 当前本地实现

### Backstage

- 数据管线页包含只读 MinerU Deployment preflight、PR #2 job 目录、固定 10 文档 MinerU smoke profile 和活动 MinerU run 拒绝逻辑。
- 新增 Catalog Template：`k12-mineru-start` 与 `k12-mineru-stop`。它们仅接受 DNS-safe request name 与文字原因，调用已注册的受限 Gitea action。
- action 只能修改 `environments/production/k12-data-pipeline/release.yaml` 中固定 MinerU Deployment 的唯一 `spec.replicas` 字段（`0 ↔ 1`）；不会写 Kubernetes，也不能传入镜像、NPU、资源、Bucket、Secret 或 Ray 参数。
- `modelPlatform.dataPipeline.mineruGitops.enabled=false` 与 `mineruLaunchEnabled=false` 继续保持关闭。因此模板/action 或 MinerU Dagster launch 均为 fail-closed。

### 配置仓库 / Tekton

- 本地 `validate-k12-mineru-gitops.py` 校验 Gitea PR 分支、唯一变更路径、固定 Deployment、唯一 replica 转换，以及已核定的运行时合同。
- 本地 `validate-k12-mineru-capacity.py` 只读检查目标节点/设备、Pod request、健康和运行进程；启动请求必须通过，停止请求不需要容量窗口。
- Tekton Pipeline 新增静态校验与 `capacity-gate-k12-mineru`，Trigger 为该 task 指定最小只读 ServiceAccount。以上均尚未通过配置仓库 PR 或部署到生产。

## 3. 本轮本地验证

- Backstage 后端定向单测：12/12 通过。
- Backstage app build、YAML 解析和 Prettier 检查通过。
- 配置仓库 K12 GitOps/capacity validator 单测：6/6 通过；`git diff --check` 通过。
- 生产只读复核：`k12-data-pipeline` 为 `Synced/Healthy`，revision `feac76fa…`；Dagster 1/1；MinerU/Qwen worker 均为 0；运行 Pod 无 Ascend910 request。

## 4. Backstage 任务工作台实现（本地，2026-09-18）

- 数据管线入口改为“清洗任务列表 + 选中任务摘要”的操作台，而非重复实现 Dagster 的节点/日志详情。
- “新建清洗任务”复用既有受控 CPU Stage 1 API：只接受固定 profile 与受批准 manifest 前缀，后端仍负责身份校验、Dagster/Ray readiness 和参数合同；本轮没有提交任何运行。
- 后端 `GET /api/data-pipeline/status` 增加独立的浏览器公开 Dagster URL。内部 Kubernetes Service URL 仅供后端访问，不能再出现在该状态响应中。
- 每条 Run 的“在 Dagster 查看 Run 详情”链接指向公开 Dagster 的 `/runs/<run-id>`；已以真实已验收 Run 路径进行只读 HTTP 复核（根页与 Run 页均返回 200）。
- 新增前端定向测试，确认任务摘要和公开 Dagster Run 链接；Backstage app build 与后端 12 项定向单测通过。

## 5. 后续发布门槛

1. 将 Backstage 与配置仓库改动分别整理为可审阅 PR，并确保 Tekton 校验成功。
2. 对生产 Tekton 改动进行最小范围 dry-run/审阅后部署；仍不启用 Backstage 开关。
3. 发布 Backstage 镜像和配置，确认 Catalog 模板、只读 preflight、任务工作台与默认关闭行为。
4. 经用户批准后，才开启固定 MinerU profile：生成 GitOps start PR → Tekton 静态/容量 gate → 合并 → 人工 Argo scoped sync → Ready preflight → 一次 10 文档 run → GitOps stop PR → 确认零副本与零 NPU。
5. MinerU 通过后，按 PR #2 能力清单分别接入 Stage 1、Qwen、质量/JSONL 和其余受限 profile；不得把本记录视为它们已可用。

## 6. Backstage 数据管线工作台发布回滚点（2026-09-18）

- 发布前生产 Deployment：`backstage/backstage` revision `69`，`1/1 Ready`，策略 `Recreate`，`revisionHistoryLimit: 2`。
- 已核定正常回滚镜像：`110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.20-direct-ui-f8a1648-r2@sha256:196ef9b98ca5eb2da917d4829bdd1e948cf847bc06e704bcf5bfa95ae7bc56a3`。
- 候选镜像仅在其不可变 digest 已写入发布记录、在生产节点可拉取、并完成健康检查后更新 Deployment。若新 revision 未 Ready，则使用 `kubectl rollout undo deployment/backstage --to-revision=69`；也可显式恢复上述 digest。回滚不修改 K12 Dagster、MinerU、Qwen 或任何数据任务。
- 已构建候选镜像：`110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.21-k12-data-pipeline-a326f96@sha256:a0855169dad50d132705216039be1c9d0b97f51099118500c7fa96987883d071`（`linux/amd64`，OCI revision `a326f961de0dd9fa574a424855683a86346b96ed`）。镜像构建已完成前端 build、后端 TypeScript 编译和新增 `dataPipelineApi` 运行时加载检查。

## 7. Backstage 任务工作台生产发布验收（2026-09-18）

- 发布源码提交：`a326f961de0dd9fa574a424855683a86346b96ed`；审阅 PR：`gitadmin/platform-backstage#16`（Open、mergeable）。用于推送/建 PR 的短时 PAT 已确认撤销。
- server-side dry-run 仅显示 `deployment/backstage` 的 `backstage` 容器镜像变化；CPU `500m`、内存 `1Gi` request 与 CPU `2`、内存 `2Gi` limit 保持不变，无 NPU 资源字段。
- 正式 rollout 生成 Deployment revision `70`，`observedGeneration=70`、`readyReplicas=1`、`updatedReplicas=1`；替换 Pod `1/1 Running`、重启数 `0`、imageID 与候选 digest 一致。revision `69` 与其已核定的正常镜像继续保留，可执行预定的 `rollout undo --to-revision=69`。
- 生产端点验收：Backstage `/healthcheck`=200、`/data-pipeline`=200、未认证 `/api/data-pipeline/status`=401；运行包包含“新建清洗任务”和 `dagsterExternalUrl` 标识。Backstage Pod → 内部 Dagster `/server_info`=200；公开 Dagster 根页及已验收 Run 页面均为 200。
- 运行边界验收：K12 Dagster 仍为 `1/1`；MinerU、Qwen 均为 `0` 副本。没有创建数据清洗任务、没有申请或使用 NPU，Backstage 新建任务按钮也未在生产点击。

## 8. Backstage → Dagster → CPU Stage 1 端到端验收（2026-09-18）

- 经明确批准后，从生产 Backstage 数据管线工作台实际提交了受控 CPU Stage 1 表单；request name 为 `backstage-stage1-e2e-20260918`，固定 Job 为 `cleanjopbstage1_10`，固定 profile 为 `k12-stage1-clean-v1`，输入 manifest 为已批准的 10 文档 smoke manifest。表单未提供、也未传递 NPU、镜像、调度或资源参数。
- Dagster Run：`1c852c5c-3f55-4b61-9d6d-31abffc4a577`；从 `STARTED` 到 `SUCCESS`，执行时长 `45.555` 秒。事件总数 `161`，`write_document_outputs`、`validate_outputs`、`write_summary` 均成功，最终事件为 `RunSuccessEvent`。
- 产物通过 Dagster daemon 对对象存储的只读核验：`s3://k12-cleaned-corpus/stage1/platform-smoke/backstage-stage1-e2e-20260918/_SUMMARY.json` 为 `success`，`total_documents=10`、`failed_documents=0`、`output_object_count=84`、`kept_blocks=23228`、`quarantine_blocks=1352`。
- 浏览器侧 Backstage 列表已自动显示该 Run 的 `SUCCESS` 状态、CPU Stage 1 摘要和真实 Dagster 链接：`http://110.120.0.3:30080/runs/1c852c5c-3f55-4b61-9d6d-31abffc4a577`。这验证了“发起任务 → 状态回显 → 跳转 Dagster 原生详情”的主操作链路。
- 运行前后全局 Ascend910 request 均为 `0`，任务完成后 Dagster `active_runs=0`；本次没有启动 MinerU/Qwen，也未使用 NPU。
- 限制：该固定 CPU profile 未启用自动 Judge/质量门，`validation_status` 为空。因此本节通过的是平台与 Stage 1 主链路 E2E 验收，不构成 verified 训练集、质量门或完整 NPU/MinerU/Qwen 能力验收。
