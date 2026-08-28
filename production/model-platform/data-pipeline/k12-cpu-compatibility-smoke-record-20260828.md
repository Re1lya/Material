# K12 CPU 兼容性 Smoke 验收记录（2026-08-28）

## 1. 边界与结论

本次直接复用 KCC main 中的既有 Dagster Job `cleanjopbstage1_10`，在新平台 CPU
控制面和 CPU Ray worker 上处理固定的 10 文档 manifest。未启动 MinerU、Qwen、Stage 2、
NPU Worker 或任何 Ascend 资源；旧 `k12/mineru-dagster` 未切换、未修改。

最终结论：**CPU Stage 1 业务兼容性、S3 合同、resume、单标记恢复和 hash 稳定性均通过。**

## 2. 输入和输出

| 项目 | 值 |
| --- | --- |
| Dagster Job | `cleanjopbstage1_10` |
| 输入 bucket | `k12-mineru-output` |
| 输入 prefix | `full-output/mineru34-hybrid-a3-full-20260722T104600Z` |
| 输入状态 | `_SUMMARY.json status=success`，`pdf_count=2595`，`failed_count=0` |
| 固定 manifest | `s3://k12-cleaned-corpus/cpu-smoke/manifests/stage1_test_10.json` |
| 输出 bucket | `k12-cleaned-corpus` |
| 输出 prefix | `stage1/platform-smoke/compat-20260828-001` |
| Stage 1 版本 | `stage1-v1.0.2` |
| 文档数 | 10 |
| resume | `true` |
| max document inflight | 8 |
| automated validation | `false`；恢复门由外部受控验收执行 |

## 3. 首次失败与最小权限修复

首次 Run `7cda9dfe-5edc-4290-801f-11fe55b78ece` / Ray submission
`stage1-clean-run-7cda9dfe` 在写 `_RUN_MANIFEST.json` 后失败。根因不是业务数据或 Ray：K12
的 `atomic_write_bytes` 协议执行“Put 临时对象 -> CopyObject 到正式 key -> DeleteObject
临时对象”，而最初的 `k12-cpu-runtime` 策略禁止全部 DeleteObject，导致临时对象清理被
MinIO 拒绝。

运行身份没有获得正式对象删除权限。策略仅增加：

```text
s3:DeleteObject
  arn:aws:s3:::k12-cleaned-corpus/cpu-smoke/*.tmp-*
  arn:aws:s3:::k12-cleaned-corpus/stage1/platform-smoke/*.tmp-*
```

验证结果：临时对象 Put/Delete 成功；对普通 `cpu-smoke/` key 的 DeleteObject 仍返回
HTTP 403。首次失败遗留的一个 `_RUN_MANIFEST.json.tmp-*` 已由管理员精确删除，最终
prefix 中无临时对象。

## 4. 首次有效运行

| 项目 | 结果 |
| --- | --- |
| Dagster Run | `a6428cb0-b8e2-4e01-973f-70b605c2ef3e` |
| Ray submission | `stage1-clean-run-a6428cb0` |
| Dagster / Ray | SUCCESS / SUCCEEDED |
| summary | status=success，success=10，skipped=0，failed=0 |
| progress | completed=10/10，failed=0，active=0 |
| `_SUCCESS.json` | 10 个 |
| 必需产物缺失 | 0 |
| `_FAILED.jsonl` | 0 bytes |
| `.tmp-*` 遗留 | 0 |

基线摘要：

```text
artifact_baseline_sha256=6dafcacd0bda973cc697a37192f7c109e02d24cfea233e410005367ce2b4b001
source_etag_baseline_sha256=ee9f5a886f228157fe1e7b479043d78bf18f2ce50023a5a347b92404be8d6841
```

## 5. Resume 全跳过验证

完全相同的输入、manifest、输出 prefix 和 `resume=true` 再次运行：

| 项目 | 结果 |
| --- | --- |
| Dagster Run | `e238095f-f6ec-49d4-91b8-9e448b8e3910` |
| Ray submission | `stage1-clean-run-e238095f` |
| Dagster / Ray | SUCCESS / SUCCEEDED |
| summary | status=success，success=0，skipped=10，failed=0 |
| `.tmp-*` 遗留 | 0 |

```text
artifact_resume_sha256=6dafcacd0bda973cc697a37192f7c109e02d24cfea233e410005367ce2b4b001
source_etag_resume_sha256=ee9f5a886f228157fe1e7b479043d78bf18f2ce50023a5a347b92404be8d6841
```

artifact 和源 ETag 摘要均与首轮一致。

## 6. 单成功标记恢复验证

管理员仅删除 smoke prefix 中：

```text
pdf-8e99cca84a22a2a45575/_SUCCESS.json
```

所有正式产物保留；删除后成功标记为 9 个。相同配置第三次运行：

| 项目 | 结果 |
| --- | --- |
| Dagster Run | `5202ff26-0301-4112-9970-22e902f9021b` |
| Ray submission | `stage1-clean-run-5202ff26` |
| Dagster / Ray | SUCCESS / SUCCEEDED |
| summary | status=success，success=1，skipped=9，failed=0 |
| 最终成功标记 | 10 个 |
| `.tmp-*` 遗留 | 0 |

```text
artifact_recovery_sha256=6dafcacd0bda973cc697a37192f7c109e02d24cfea233e410005367ce2b4b001
source_etag_recovery_sha256=ee9f5a886f228157fe1e7b479043d78bf18f2ce50023a5a347b92404be8d6841
```

仅缺失标记的文档被重处理，另外九个跳过；产物 hash 稳定，源对象未变化。

## 7. 完成后集群状态

- 新 Dagster Deployment 1/1，Pod 2/2 Running，0 restart；
- RayCluster ready，head 1/1、CPU worker 1/1，0 restart；
- 所有四个 Ray submissions 均为终态，active Ray job=0；
- 新 Dagster active run=0；
- server-00 实际约 6% CPU / 8% memory；
- RayCluster spec 未发现 Ascend、MinerU/Qwen worker、HostPath 或 privileged；
- 旧 `mineru-dagster` 仍为 1/1、Pod 2/2 Running、0 restart，NodePort 30080 未动。

## 8. 状态兼容问题及后续修复

预迁移的旧 Dagster 数据位于：

```text
$DAGSTER_HOME/history
$DAGSTER_HOME/schedules
```

新 Chart 当前显式配置的 SQLite base_dir 为：

```text
$DAGSTER_HOME/storage
```

因此 smoke 执行时新控制面的 4 条 runs 写入 `$DAGSTER_HOME/storage/history`，旧 62 条
运行历史仍位于 `$DAGSTER_HOME/history`。2026-08-28 后续受控窗口已短暂停止两个
Dagster，将 smoke 状态归档，并把旧 `history/`、`schedules/` 通过 SQLite online backup
迁入新 PVC 的 `storage/` 布局。66/66 数据库 quick_check=ok；新 Dagster 已验证可见旧
62 条历史。详情见 `k12-dagster-state-storage-migration-20260828.md`。

## 9. 下一步

1. 发布 Backstage K12 运行/状态入口；
2. 最终切换前比较旧、新 runs 数量；若旧服务产生增量，重复最终同步；
3. 完成 Service 入口切换和回滚评审；
4. 稳定后退役旧 HostPath Deployment；
5. NPU 阶段继续保持关闭。
