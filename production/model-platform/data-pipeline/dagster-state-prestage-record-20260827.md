# K12 Dagster 状态初始预迁移副本记录（2026-08-27）

> **这是初始预迁移副本，不是最终切换副本。最终切换前必须确认无 active run，
> 并在受控窗口进行最终同步。**

## 1. 时间与身份

| 项目 | 值 |
| --- | --- |
| 执行日期 | 2026-08-27 |
| 生产节点时间（UTC） | 操作起于约 07:51 UTC，止于同小时内 |
| 目标主机 | `server-00`（110.120.0.3） |
| 身份检查 | `hostname=server-00`、`id -un=admin`、`pwd=/home/admin` |
| 认证方式 | SSH 密钥（任务专用临时公钥）；sudo 密码仅经 stdin 提供，未写入任何文件、命令参数或日志 |

## 2. 任务边界

本次只完成一个动作：为现有 K12 Dagster 状态建立初始预迁移副本并验证副本完整性。

- 未停止、未修改旧 `k12/mineru-dagster`；
- 未创建或修改任何 Kubernetes 对象；
- 未执行任何 `kubectl apply`，未创建 StorageClass / PV / PVC / Secret；
- 未合并 GitOps PR #5，新 K12 Deployment、RayCluster 仍不存在。

## 3. 开始前基线

### 3.1 旧 K12 状态

| 项目 | 观测值 |
| --- | --- |
| Deployment | `k12/mineru-dagster`，`1/1 Available`，38d |
| Pod | `mineru-dagster-fdccb89d7-jgbh4`，`2/2 Running`，0 restarts |
| daemon 日志 | 仅 code-server heartbeat warning 与 `ray_job_status_sensor` 每 30s 空轮询 |

### 3.2 活跃运行核查（只读）

对源 `history/runs.db` 以只读 URI 查询：

```text
active_run_count=0
```

验收要求满足，允许继续。

## 4. 源与目标

| 项目 | 路径 | 初始观测 |
| --- | --- | --- |
| 源目录 | `/home/admin/testpanxy/ray_job_test/dagster_home` | owner `root:root`，mode `755`，91MiB，3933 个文件 |
| 目标目录 | `/mnt/data/k12-data-pipeline/dagster-home` | 执行前不存在（与已知事实一致） |

目标目录以如下方式创建：

```bash
install -d -m 0750 -o root -g root \
  /mnt/data/k12-data-pipeline/dagster-home
# 结果：owner=root:root mode=750
```

该路径即未来 PV 的目标目录
（见 `production/model-platform/data-pipeline/gitops/storage.yaml`，
本次未对该文件执行 apply）。

## 5. 同步与刷新结果

### 5.1 rsync 初始同步

```bash
rsync -aH --numeric-ids \
  /home/admin/testpanxy/ray_job_test/dagster_home/ \
  /mnt/data/k12-data-pipeline/dagster-home/
```

无 `--delete`。结果：exit=0。

| 项目 | 同步后源 | 同步后目标 |
| --- | --- | --- |
| du | 91M | 91M |
| 文件数 | 3933 | 3933 |

**权限修正（2026-08-27 补记）：**`rsync -a` 将源目录的 `755` 属性传播到了
目标根目录，使 `install -d -m 0750` 的初始权限被覆盖为 `755`。复核发现后已执行：

```bash
chmod 0750 /mnt/data/k12-data-pipeline/dagster-home
# 复核结果：owner=0:0 mode=750
```

源目录内部子目录与文件的属主/权限保持与源一致，不做额外修改。
未来受控窗口的最终同步命令应预期同样的属性覆盖行为，同步后必须重新
把目标根目录恢复为 `0750`。

### 5.2 SQLite online backup

因旧 Dagster 仍在运行，rsync 不能保证 SQLite 文件一致性；随后对源目录全部
66 个 `.db`（含 `history/runs.db`、`schedules/schedules.db`、
`history/index.db` 及 `history/runs/<run_id>.db` 共 63 个）逐个使用
SQLite backup API 写入 `.backup-tmp` 后原子替换：

```text
database_count=66
sqlite_online_backup=PASS
```

### 5.3 完整性验证

对目标目录全部 66 个 `.db` 执行 `pragma quick_check`（只读 URI）：

```text
database_count=66
66/66 quick_check=ok
sqlite_integrity=PASS
```

## 6. 关键数据库统计

目标端 stat（不打印任何业务数据内容）：

```text
history/runs.db        size=696320    owner=0:0 mode=644
schedules/schedules.db size=26726400  owner=0:0 mode=644
```

目标 `history/runs.db` 只读查询统计：

```text
target_total_runs=62
target_success_runs=43
target_active_runs=0
```

## 7. 完成后旧服务状态复核

| 项目 | 复核值 |
| --- | --- |
| Deployment | `k12/mineru-dagster` 仍为 `1/1 Available` |
| Pod | `mineru-dagster-fdccb89d7-jgbh4` 仍为 `2/2 Running`，restarts 仍为 0 |

未执行 rollout、scale、restart 或 patch；旧 HostPath 未修改。

## 8. 遗留事项与边界声明

- 本副本是**初始预迁移副本**，不是最终切换副本；
- 最终切换前必须：确认无 active run（STARTED/STARTING/CANCELING 为零），
  在受控窗口暂停新任务提交并重新执行一次在线备份式最终同步；
- 后续工作仍包括：GitOps PR #5 评审合并（StorageClass/PV/PVC）、Secret 创建、
  新 K12 Deployment/Dagster foundation 的 dry-run 与生产 apply；
- 本次过程产生的 `k12-prestage-temp-20260827` 临时 SSH 公钥已在后续验收中从
  server-00 `authorized_keys` 精确移除；原 `ray-proxy-tunnel-110.120.0.3` 公钥保留。

本记录不含 SSH 密码、Token、Secret data、kubeconfig、MinIO access key、
run body 或任何业务数据内容。
