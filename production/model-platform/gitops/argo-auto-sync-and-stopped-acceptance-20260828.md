# Argo scoped auto-sync 开启与 Stopped 全自动验收记录 — 2026-08-28

> 本文记录生产 Gitea main `0021e86439d43ef93b0f79587dfaeb8b57b51a44`
> 的两个连续原子阶段：为 `model-platform-deployment-requests` 开启受限
> automated sync，以及随后 `qwen38-stopped-auto-smoke` 的零 NPU 全自动
> Stopped 验收。密码、Token 与 Secret data 不进入本文。

## 1. 前置状态

- Stopped auto-merge 已在生产发布并通过 PR #11 验收（见
  `../tekton/model-deployment-auto-merge-20260828.md`）。
- Gitea main 为 `0021e864…`，其中包含 PR #11 合入的
  `environments/production/modeldeployments/qwen38-stopped-auto-smoke.yaml`。
- Argo `model-platform-deployment-requests` 为 OutOfSync/Healthy，
  `spec.syncPolicy.automated` 不存在。

## 2. 开启前的安全门禁

1. 备份：`kubectl get application model-platform-deployment-requests -n argocd
   -o yaml` 保存到 `server-00:/tmp/model-platform-release-20260828-automerge/
   deployment-requests-backup-pre-autosync.yaml`（212 行）；同步历史记录在案
   （最近一次人工 Sync 为 2026-08-28T08:48:05Z @ `16d36213…`，initiatedBy
   `codex-authorized-cleanup`）。
2. server-side dry-run 通过：
   `sudo k3s kubectl apply --dry-run=server -f modeldeployments-application.yaml`。
3. `kubectl diff` 精确显示唯一变更为新增
   `syncPolicy.automated` 与 `syncPolicy.retry`，无其他字段变化。
4. AppProject `model-platform-control-plane` 检查：
   - `sourceRepos` 仅生产配置仓库；
   - destinations 为 `model-serving` 与 `kcc-training` 两项。`kcc-training`
     为训练集成的既有事实，本阶段未修改、也不得修改；本 Application 的
     destination 仍只有 `model-serving`。
5. OutOfSync 差异确认仅含 `qwen38-stopped-auto-smoke` 一个对象，无其他业务
   变更混入。

## 3. 开启的精确策略

Material `production/model-platform/gitops/modeldeployments-application.yaml`
（镜像 checksum
`3300620f65586542d06e63c5d7e9e6e26ad5fc9597830f2051ec9792ea9bb735`）：

```yaml
syncPolicy:
  automated:
    prune: false
    selfHeal: false
    allowEmpty: false
  retry:
    limit: 3
    backoff:
      duration: 10s
      factor: 2
      maxDuration: 2m
  syncOptions:
    - CreateNamespace=false
    - ApplyOutOfSyncOnly=true
```

生产 apply 后线上对象确认
`AUTOMATED={"allowEmpty":false,"prune":false,"selfHeal":false}`。

## 4. 回滚命令（关闭 automated sync）

```bash
sudo k3s kubectl patch application model-platform-deployment-requests \
  -n argocd --type=json -p='[{"op":"remove","path":"/spec/syncPolicy/automated"},{"op":"remove","path":"/spec/syncPolicy/retry"}]'
```

完整备份文件保留在
`server-00:/tmp/model-platform-release-20260828-automerge/`。

## 5. 自动同步结果

- apply 约 30 秒后 Application 变为
  `Synced/Healthy`，`status.sync.revision` 为 `0021e864…`。
- 自动同步只物化了 Git 中已有的一个新请求，无 prune、无删除、无手工干预。

## 6. Stopped 全自动验收证据

端到端链路：
`Backstage 生成分支 -> Tekton 校验+自动合并(PR #11) -> Gitea main(0021e864…)
-> Argo automated sync -> Crossplane -> control-plane-only Composition`。

| 检查项 | 结果 |
| --- | --- |
| XR `model-serving/qwen38-stopped-auto-smoke` | 存在，`Synced=True/Ready=True`，age 与同步时间一致 |
| compositionRef | `modeldeployment-control-plane-v1alpha1` |
| placement.acceleratorPool | `control-plane-only` |
| desiredState / workerReplicas | `Stopped` / `0` |
| requested-by / request-mode | `automation-smoke` / `declarative-stopped` |
| 组合产物 | 仅 ConfigMap `model-serving/qwen38-stopped-auto-smoke-status`（`phase=AwaitingApproval`、`npuRequested=0`） |
| 新 Pod / Job / PVC | 无（`model-serving` 仅保留 qwen38-27b 既有 CPU head、两个历史 Complete Job 与既有 PVC） |
| RayService/RayCluster | smoke 无任何 Ray 对象；全集群 Ray 对象均为既有业务（ds、k12、ray-demo、qwen38-27b 停止态） |
| NPU requests | 全集群为 0 |
| 跨 namespace 对象 | 无 |
| 其他 Application | `k12-data-pipeline`、`model-platform-bootstrap`、`model-platform-training-system` 均 Synced/Healthy，未被本阶段触碰 |

## 7. 结论与边界

- 停止态全自动链路（自动合并 + scoped 自动同步 + 零 NPU Stopped XR）在生产
  成立。
- prune/selfHeal/allowEmpty 保持 false；删除 Git 中的 ModelDeployment 仍不会
  触发级联删除。
- `qwen38-stopped-auto-smoke` 保留为 Stopped 自动化验收对象，不清理。
- 一键关闭 automated sync 的回滚命令已在第 4 节给出，其实际演练在
  Stop/Rollback 验收阶段执行。
