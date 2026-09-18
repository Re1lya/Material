# K12 新平台 legacy 作业复验记录 — 2026-09-18

> 记录类型：作业级复验结果与阻断项。不含密码/Token/Secret。
> 方法：通过 Dagster GraphQL `launchRun`，使用仓库内已审阅的 run-config；
> 逐作业运行并读取 compute logs。

## 1. 复验矩阵

| 作业 | Run ID | 结果 | 根因 |
| --- | --- | --- | --- |
| `platform_audit_daily_job` | 271a032b-2d33-4b8d-958c-67f71fdab876 | FAILURE（启动即失败） | TIME_WINDOW 分区集 `platform_audit_daily_job_partition_set` 无任何 partition key；未带分区启动触发 `context.partition_key` invariant |
| `textbook_statistics_job` | 927d31d5-366e-4716-8400-0d7a8967c3eb | FAILURE | 上游资产为 DYNAMIC 分区，分区集为空；`asset_partitions_subset_for_input` invariant |
| `register_existing_mineru_batch_job` | 432267a6-3110-437b-a58a-e98c25f1b7f1 | FAILURE（2 步成功） | `load_or_rebuild_manifest` 写 `production/mineru/batch-002` → S3 `PutObject` AccessDenied（IAM 范围外） |
| `cleaning_smoke_10_job` | f502e5de-81b8-4e5e-871a-0e0c6a033b21 | FAILURE | Ray 作业 FAILED：写 `cleaning-smoke-10-001` → AccessDenied |
| `cleanjopbstage1_10` | b1e97fb2-9ca0-4c7a-b740-e4aa77d70727 | FAILURE | `resolve_source_manifest` 写 `stage1/test-10/...` → AccessDenied |
| `mineru_finalize_job`（dagster-smoke-001） | a897d3ba-4e8f-4faa-80d1-9205531f750e | FAILURE | `load_submission_state` 查询历史 Ray job `mineru-dagster-dagster-smoke-001-1784513277` 返回 404（Ray Head 重建后历史已重置） |

未运行（已确认不可直接运行）：

- `cleaning_full_job`、`cleanjopbstage1_ful`：同 IAM 写范围阻断 + 全量规模。
- `mineru_submit_job` / `mineru_smoke_10_job`：依赖已退役的 MinerU A/B localhost 服务与
  静态 14/15 映射，与新动态选卡/新 launcher 合同不兼容。
- `qwen_vllm_8npulifecycle_job`：硬编码已删除对象（`qwen36-35b-a3b-worker-8npu` 等）→ 404。
- `qwen_vllm_lifecycle_job`（start/restart 路径）：会重写 launcher ConfigMap，覆盖
  动态 supervisor，违反 WorkerLifecycle/Lease 合同。
- `qwen_chat_job`：硬编码已退役 Service `qwen36-35b-a3b.k12.svc:8000`。
- `qajobstage2_*` / `qa_stage2_8_*`：需常驻 Qwen worker（新拓扑无静态 Service/4-endpoint Pod），
  且输出前缀 `stage2/...` 不在当前 IAM 写范围。
- `textbook_mineru_clean_qa_demo_job`：同 MinerU/Qwen 旧拓扑依赖。
- `__ASSET_JOB`：同 asset 分区问题。
- 训练 JSONL 收集：`stage2_collect/driver.py` 为独立 CLI，要求 `quality_status=verified`
  且 `judge.accept=true`，未接入任何 Dagster job；本轮 no-Judge 输出不满足。

## 2. 结论

新平台核心数据链路（`k12_e2e_autoscale_nojudge_job`：PDF→MinerU→Stage1→Qwen QA）
已于同日完成 10/10 全链路验收。legacy 作业目录完整、可发现，但复验被两类边界阻断：

1. **MinIO 最小权限范围**：`k12-pipeline-s3` 只允许新 autoscale 运行输出前缀写入；
   所有 legacy 输出前缀（`production/mineru/*`、`cleaning-*`、`stage1/test-10`、
   `_control/dagster/registrations` 等）被 AccessDenied 拒绝。
2. **旧 NPU 拓扑退役**：旧 MinerU A/B 服务、`qwen36-35b-a3b(-8npu)` Service/Deployment/
   ConfigMap 已删除，相关作业的硬编码对象与设备映射合同不再存在。
3. 附带：Ray Head 重建后历史 Ray job 查询 404，历史 `mineru_finalize_job` 不可复放。

## 3. 处置决定（2026-09-18）

用户裁定：这些作业大部分是为演示而创建，**不能验证即可不验证**；只有在存在代码
错误或安全漏洞导致无法运行时才修复；**主要全链路 10/10 成功即视为达标**。

据此：

- 本轮全部失败均为环境/范围/退役拓扑原因（asset 分区未注册、MinIO 最小权限写范围、
  Ray Head 重建导致历史 Ray job 丢失、旧 MinerU/Qwen 拓扑对象已删除），
  **未发现代码缺陷或安全漏洞，不进行修复**。
- 不扩展 `k12-pipeline-s3` 的 legacy 写权限；不恢复旧 NPU 拓扑；不注册演示分区。
- 保持现状：唯一受支持并已验收的数据链路为
  `k12_e2e_autoscale_nojudge_job`（PDF→MinerU→Stage1→Qwen QA，10/10）。
- 后续如需复用 legacy 能力（注册、finalize、清洗），应作为独立产品决策，
  改写并纳入 WorkerLifecycle/新输出前缀，而不是恢复旧拓扑或放宽 IAM。
