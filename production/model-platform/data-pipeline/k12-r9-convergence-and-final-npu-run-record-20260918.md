# K12 autoscale16 r9 收敛与最终 NPU 全链路验收记录 — 2026-09-18

> 记录类型：GitOps 收敛、AppProject 变更、最终 NPU 全链路运行证据。
> 本文不包含密码、Token、Secret data、kubeconfig。
> 关联：`k12-mineru-device-mismatch-stop-record-20260918.md`、
> `k12-autoscale16-convergence-runbook-draft-20260918.md`、
> `R9_SOURCE_HANDOFF_20260918.md`（github.com/panxy1019/embeding_daft）。

## 1. 结论

- **声明态收敛完成**：config PR #60（r9 渲染）+ #61（保留对象）、经批准的
  AppProject 最小扩权后，Argo Application `k12-data-pipeline` 为
  `Synced / Healthy`，revision `feac76fa71281b28e6a4ba9060dd7958d81d2904`，
  23/23 资源同步。
- **最终全链路 NPU 测试成功**：Dagster run
  `bd5388b4-3537-4434-b082-049be04427af`，10/10 文档成功，QA/MCQ 为
  schema-valid-unjudged；Ray job SUCCEEDED；Dagster 139 步成功 0 失败。
- **收尾干净**：8 个 NPU worker Deployment 全部 replicas=0、无 Ascend 请求 Pod、
  Lease 已释放；A3 8/8 设备无运行进程、16 chip `Health=OK`。

## 2. GitOps 收敛证据

| 步骤 | 内容 | 证据 |
| --- | --- | --- |
| config PR #60 | `release.yaml` 替换为 autoscale16 r9 渲染（digest 固定） | head `52aad63c`，merge `dea931d5`；Tekton `2gt7k`/main `l9c8n` 绿 |
| config PR #61 | 新增 `platform-retained.yaml`（2 ingress NetworkPolicy、SA、兼容 Service `mineru-dagster` NodePort 30080）并更新 kustomization | head `1a8b6aed`，merge `feac76fa`；Tekton `wxk29`/main `fm6rh` 绿 |
| AppProject | 用户批准后最小扩权：namespace 白名单 +`Role`/`RoleBinding`，cluster 白名单 +`ClusterRole`/`ClusterRoleBinding` | server-side dry-run 通过后 apply；`kubectl get appproject` 复核 |
| Argo sync | prune=false、ApplyOutOfSyncOnly=true；`revision=feac76fa`，无未同步资源 | operationState Succeeded；运行后再次复核仍 Synced/Healthy |

镜像（不可变 digest）：

```text
Dagster 0.5.3-autoscale16-20260918-r9@sha256:5aedca9e61299a76b0f791d68623f3e9eaa330eb9c39152ecc32efb0747077cf
MinerU official-v0.11.0-20260715-ray248-lake-20260716@sha256:878cce76d3e954cbddec8d7870d8d7288ce1e561fc52a99cf2d5346efee026ae
Qwen   v0.21.0rc1-a3-20260713-s3@sha256:d6f9824f0460e1bc814e4eb2466c5dfd5878b821263c42bd1d17cc9b0504cc28
Ray    kcc-data-pipeline:0.4.0-cpu-528da6f@sha256:f37687ea197794cbeb471505f193c19adbbb5e29133b245dff6c505dc1756718
```

源码 provenance：`Re1lya/kcc` 分支 `review/k12-autoscale16-r9`（3 commits：
handoff r9 模块导入、输入/存储合同加固、RayCluster live 启动合同保留）；
handoff tar sha256 `3e9ef1bbe8498d7639ed3154a528fed5fe1af65396356529da92f86f1bdf99ec`。
评审 PR：`panxy1019/kcc#1`（stacked on PR #2，base `feature/k12-data-pipeline-dev`，
3 commits、66 files、+5595/-197，截至记录时 open/mergeable）。
渲染与 live 运行时逐项比对：18/19 对象逐字一致；RayCluster 保持 live 启动合同
（head lifecycle env 在 site profile 关闭、CPU worker 显式 `ray start` 命令固定），
仅 MinerU launcher ConfigMap 随 chart 更新（同步时 worker 均为 0）。

## 3. 最终全链路 NPU 测试

- Run：`bd5388b4-3537-4434-b082-049be04427af`，06:08:30Z → 06:32:52Z（约 24.4 分钟）。
- 配置：`count=10`、`mineru_batch_size=4`、`mineru_max_workers=2`、
  `qa_max_pods=3`、`qa_actors_per_pod=2`、`inference_slots=4`、
  `max_blocks_per_document=0`、`resume=true`、**无** `reuse_stage1_prefix`
  （真实 PDF → MinerU → Stage1 → Qwen QA）。
- Ray job `k12-autoscale-nojudge-bd5388b4-353`：SUCCEEDED。
- Dagster：139 步成功、0 失败（含收尾观察步骤）。
- `_SUMMARY.json`：
  `s3://k12-cleaned-corpus/stage2/npu-smoke/autoscale-nojudge/bd5388b4-353/stage2/_SUMMARY.json`
  - `status=success`、`total_documents=10`、`success_documents=10`、`failed_documents=0`
  - `validation_status=schema_valid_unjudged`、`judge_enabled=false`
  - 业务 `elapsed_seconds=1002.738`
  - Qwen：6 个 TP1 endpoint（3 Pod × 2），`submitted=304`、`completed=304`
- 设备映射：MinerU Pod 实际 annotation 与 `AscendReal` 均为
  `Ascend910-6,7` 与 `Ascend910-10,11`，physical=logical，`/dev/davinci6,7` 等；
  Qwen endpoint 的 chip/logical id 取自同一 `assigned.json`；
  A3 运行期进程仅出现在对应卡（NPU 3、5），结束后全部消失。
- 收尾复核：worker 全 0、无 Ascend Pod、Lease 删除、A3 8/8 无进程、
  16 chip Health=OK；Argo 仍 `Synced/Healthy`。

## 4. 已知遗留（不影响本轮验收）

1. MinerU Pod 运行期 K8s readiness 为 0/1：探针登录 shell 开销
   （30001/30002 实际已服务请求）。建议后续按 Qwen 的非登录 `sh` 探针对齐。
2. 每个 worker 首次启动因设备 annotation 尚未就绪而 fail-closed 退出一次后
   重启（安全行为）；可考虑有界等待 annotation 再退出，减少重启。
3. 陈旧 Dagster run `2942d17f-9638-4b0a-bcb5-18f7227a6de2` 仍显示 `STARTED`
   （driver 中断、无 endTime）；待用户授权后按 `MARK_AS_CANCELED_IMMEDIATELY`
   标记取消。
4. 本轮为 no-Judge 产物（schema_valid_unjudged），不得汇入 verified 训练集。

## 5. 回滚点

- Argo 声明回滚走 config PR（不要直接回退 Application）；上一声明 revision
  `face37dbe674e3109d02d178f7c4864e69ba4c6e`。
- AppProject 回滚：移除本轮新增的 4 个 RBAC kind，恢复
  `clusterResourceWhitelist: []`。
- 源码回滚/追溯：`Re1lya/kcc` 分支 `review/k12-autoscale16-r9` 与 handoff tar。
