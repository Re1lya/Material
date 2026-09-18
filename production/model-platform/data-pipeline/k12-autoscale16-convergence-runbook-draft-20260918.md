# K12 autoscale16 收敛与验收 Runbook（草稿）— 2026-09-18

> 状态：**并行准备草稿，非发布证据**。并行工作流（同事）仍在调试设备映射与
> 端到端冒烟；冻结候选前不得据本文执行生产写入。
> 关联：`k12-mineru-device-mismatch-stop-record-20260918.md`、
> `k12-pr2-full-pipeline-execution-plan-20260917.md`。

## 1. 当前基线

- Git/Argo 声明：PR #59 停止态已收敛（merge `face37dbe…`），后因并行直连改动，
  Argo `k12-data-pipeline` 为 `OutOfSync / Healthy`；OutOfSync 资源：
  `mineru-launcher`、`qwen-launcher`、`dagster`、`mineru`、`qwen`、
  RayCluster `k12-clean-qa`。
- 并行工作流（用户授权）已在 live 测试 autoscale16：MinerU/Qwen 由 Dagster
  driver 通过 Lease `k12-npu-pipeline` 控制副本数（0..2 / 0..6），设备由
  Volcano 动态分配、launcher 从 Pod annotation 推导并 fail-closed。
- 初版实施报告（`AUTOSCALE_16_NPU_IMPLEMENTATION_REPORT.md`）记录：12/12 单元测试、
  Helm 静态验证、server-side dry-run 通过；十本端到端曾因 MinIO 凭据
  `PutObject` 权限不足在 manifest 阶段失败，未拉起 NPU Worker。
- 本地已完成只读审查快照：
  - 源码 tar sha256 `3fb436c3349997ba00492676dc0a4f0d56cc278267d3ae46588f91ed4e69dacc`；
  - 相对 PR #2 head `2fd605c` 的候选 diff：24 文件 +1775/-131，
    已存 `/tmp/kcc-autoscale16-snapshot/k12-autoscale16-snapshot-r3.patch`
    （sha256 `7a663415b8a13be47e50a1b6df68d18cd451ebf5595c7001819665b0ac8ba686`）；
  - 与本地未提交的合同加固改动（`contracts.py`、`ray_job_ops.py`、`s3_ops.py`、
    `test_contracts.py`、`validate.sh` + `validate_profile_contracts.py`）**文件不重叠**。

## 2. 冻结候选时必须提供的输入

1. autoscale16 源码 commit（kcc 侧）或最终 tar，含 `npu_worker.py`、
   `dynamic-launchers.yaml`、`lifecycle.py`、`qwen_pool.py`、driver 与 job。
2. 镜像 tag → Artifact Keeper `110.120.0.3:30670` immutable digest（Dagster
   overlay 至少；MinerU/Qwen 若变更则一并），并核验 `linux/arm64`。
3. MinIO `k12-pipeline-s3` 身份的运行输出权限已完成（GET/PUT、原子 COPY
   源/目标、临时对象 DELETE、multipart、必要 list），且探针对象已清理。
4. 确认无活动 Dagster run、无 `k12-npu-pipeline` Lease、无 Worker Pod。

## 3. 收敛步骤（按序执行，逐门禁停）

1. **kcc PR**：在 PR #2 分支上应用候选 diff，叠加本地合同加固改动；
   本地 Helm lint/render（default/smoke/production/autoscale16）与单元测试
   通过后推送评审。
2. **镜像**：按 `Dockerfile.autoscale16` 构建并推送 30670，校验 digest/架构；
   Git 中一律以 digest 引用。
3. **渲染**：用 `values-autoscale16.yaml` + site override 渲染
   `environments/production/k12-data-pipeline/release.yaml`，替换镜像 digest，
   确认 MinerU/Qwen replicas=0、无静态物理卡号/`predicate-time`。
4. **config PR**：仅提交渲染产物；Tekton 7 项校验通过；人工/受控合并。
5. **Argo scoped sync**：确认无运行中任务后，prune=false、
   ApplyOutOfSyncOnly=true，仅同步本次变更资源；目标 Argo 全量 `Synced/Healthy`。
6. **NPU 启动授权**：完成恢复门槛（启动器 fail-closed 已声明、镜像 digest 固定、
   A3 无未授权进程）后，单独向用户申请启动窗口。
7. **唯一 10 文档冒烟**：固定 batch_id；核验 Pod Ready、`assigned.json`
   与 Volcano annotation 一致、无越权设备进程；完成后 finalize、质量校验、
   回到零副本并确认无残留 Pod/Lease/NPU 进程。
8. **Material 验收记录**：记录 run ID、batch_id、设备映射、镜像 digest、
   Argo revision、零副本与 A3 证据。

## 4. 验收判据

- config PR 合并、Tekton 绿、scoped sync 后 Argo **全量 Synced**；
- 唯一 batch_id 的 NPU MinerU 端到端成功（正确设备映射），产物可追溯；
- 成功/失败均自动回到 replicas=0、Lease 释放、无 NPU 残留进程。

## 5. 禁止事项

- 不在运行期间做任何 Argo sync（手动 sync 会回退 controller 拥有的 replicas）；
  运行前/后再同步，或后续评审 `ignoreDifferences`。
- 不把直接 `kubectl apply/patch` 作为最终声明态或验收证据。
- 不在未授权、未完成恢复门槛时启动任何 NPU 工作负载。
- 不在 values/脚本/文档中写入密码、Token 或 Secret data。
