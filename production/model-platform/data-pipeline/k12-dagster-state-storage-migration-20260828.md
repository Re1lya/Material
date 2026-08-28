# K12 Dagster 状态迁入新 storage 布局记录（2026-08-28）

## 1. 目标与边界

将旧生产 Dagster 的完整 `history/` 和 `schedules/` 迁入新 PVC 当前 Helm Chart 使用的：

```text
/mnt/data/k12-data-pipeline/dagster-home/storage/history
/mnt/data/k12-data-pipeline/dagster-home/storage/schedules
```

不逐行合并两套 SQLite；新控制面的 4 条 compatibility smoke 记录独立归档。迁移期间旧、
新 Dagster 短暂停止，Ray CPU 集群保持运行但没有 active job；验收后两个 Dagster 均恢复，
NodePort 尚未切换。

## 2. 迁移前状态

| 状态源 | total | success | active |
| --- | ---: | ---: | ---: |
| 旧生产 `$DAGSTER_HOME/history` | 62 | 43 | 0 |
| 新控制面 `$DAGSTER_HOME/storage/history` | 4 | 3 | 0 |

新控制面的 4 条记录包括 compatibility smoke 的一次预期权限失败和三次成功运行。
迁移前 Ray active job=0。

## 3. Smoke 状态归档

新控制面的原 `storage/` 和 `compute_logs/` 以同文件系统 move 的方式归档到：

```text
/mnt/data/k12-data-pipeline/dagster-smoke-state-archive-20260828T0148Z
```

归档数据库验收：

```text
archived_smoke_runs=4
archived_smoke_success=3
archived_smoke_failure=1
archive_quick_check=ok
```

归档未删除，owner `root:root`，mode `0750`。

## 4. 迁移过程

1. 再次确认旧、新 runs DB active=0，Ray active job=0；
2. 将 `k12/mineru-dagster` 和新 K12 Dagster Deployment 临时 scale 到 0，并等待 Pod 删除；
3. 创建新的 `$DAGSTER_HOME/storage/history`、`storage/schedules` 和 `compute_logs`；
4. 使用 `rsync -aH --numeric-ids` 复制旧 `history/`、`schedules/`；
5. 对源目录全部 66 个 SQLite 数据库使用 SQLite online backup API 写入目标对应路径并
   原子替换；
6. 对目标 66 个数据库执行 `pragma quick_check`；
7. 先启动新 Dagster，确认历史可见，再恢复旧 Dagster。

未使用 `--delete`，未修改 MinIO 数据，未提交 Ray Job 或 NPU workload。

## 5. 数据库验收

```text
database_count=66
sqlite_online_migration=PASS
target_database_count=66
quick_check_ok=66
quick_check_failures=0
target_total_runs=62
target_success_runs=43
target_active_runs=0
```

未遗留 `.migration-tmp` 或 `.backup-tmp` 文件。

## 6. 新 Dagster 验收

新 Dagster 启动后直接从 `storage/history/runs.db` 读取：

```text
visible_total_runs=62
visible_success_runs=43
visible_active_runs=0
server_info_status=200
```

最近历史包括 `qwen_vllm_lifecycle_job`、`k12_e2e_autoscale_nojudge_job` 等旧生产记录，
证明不仅能读取 runs 表，也能识别原有 Job 历史。新 Pod 2/2 Running、0 restart。

## 7. 恢复后的状态

- 新 K12 Dagster：Deployment 1/1、Pod 2/2 Running；
- 旧 `mineru-dagster`：Deployment 1/1、Pod 2/2 Running；
- 旧 NodePort 30080 保持不变；
- Argo Application `k12-data-pipeline` 保持 Synced/Healthy；
- 旧、新数据库均为 total=62、active=0；
- server-00 实际约 7% CPU / 8% memory；
- 新状态目录 owner `root:root`，Dagster home mode `0750`。

## 8. 后续边界

本次已解决“新 UI 看不到旧 62 条历史”的目录兼容问题。但旧服务恢复后仍可能产生新的
运行记录，因此最终服务切换窗口必须再次比较旧、新 run 数量：

- 若旧库仍为 62 且 active=0，可直接进入切换验收；
- 若旧库出现增量 run，需再次停止两个 Dagster，并仅重复 history/schedules 的最终同步和
  quick_check；
- compatibility smoke 的 4 条运行记录继续保存在独立归档和 smoke 验收文档中，不并入
  生产 SQLite。

下一阶段仍包括 Backstage K12 状态/运行入口、服务切换评审、最终增量检查和旧 HostPath
Deployment 退役。NPU 阶段继续关闭。
