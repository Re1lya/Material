# K12 MinerU NPU 设备分配不一致失败与停止记录 — 2026-09-18

> 记录类型：失败根因、紧急停止证据与恢复门禁。
> 本文只记录已观察事实和已执行操作；不包含密码、Token、Secret data、kubeconfig。
> 相关计划：`k12-pr2-full-pipeline-execution-plan-20260917.md`；
> 实时基线：`../CURRENT-STATE-20260917.md`。

## 1. 结论

2026-09-18 首次受控 MinerU NPU 启动在就绪阶段失败。根因不是 Volcano 调度失败：
Volcano 已把 Pod 调度到 `a3-server-00`（含 `accelerator-type=module-a3-16`、
`kubernetes.io/arch=arm64`、A3 hostname），符合 16 卡 nodeSelector 方案。

实际根因是设备分配合同不一致：

- Helm/启动器静态声明 `huawei.com/Ascend910: "Ascend910-14,Ascend910-15"` 与
  `MINERU_PHYSICAL_DEVICES=14,15`；
- Volcano/MindX 在调度后把实际分配重写为 `Ascend910-12,Ascend910-13`；
- 容器为 `privileged: true` 且挂载宿主 driver/dcmi/npu-smi，启动器按静态 14/15
  启动了 `mineru-vllm-server`（30001/30002），访问的不是本 Pod 的分配设备；
- 调度后没有任何“静态声明 = 实际 annotation = 容器可见设备”一致性校验与
  fail-closed/自动 Stop，readinessProbe 5s（PR #58）只是暴露了该缺陷。

未发起任何 MinerU Dagster smoke run。已执行停止：紧急 scale 0；PR #59 将声明态
`replicas 1→0` 合并；Argo scoped sync 后声明 revision=`face37dbe`，MinerU
Deployment `Synced`、0/0，k12 无 MinerU Pod；集群无 `huawei.com/Ascend910`
请求；A3 全部 16 chip `Health=OK` 且无运行进程。Qwen 全程零副本、未触碰。

## 2. 时间线（UTC，2026-09-18）

| 时间 | 事件 | 证据 |
| --- | --- | --- |
| 01:15:46 | MinerU 启动（PR #57 渲染） | RS `…mineru-5fd7f64b74`；Pod `nrhsz` 调度到 a3-server-00 |
| 01:17:16–01:19:43 | PR #57 Tekton 校验 | PipelineRun `dqfqv` Succeeded；head `e3a80c1b`；merge `c2753213` |
| 01:20:32–01:21:44 | PR #57 main push 校验 | `rwwmx` Succeeded（`c2753213`） |
| 01:31:42–01:34:09 | PR #58（readinessProbe 1→5s）校验 | `nbl9h` Succeeded；head `4f9c61d7`；merge `608ce87e` |
| 01:34:29–01:35:40 | PR #58 main push 校验 | `fp5kw` Succeeded（`608ce87e`） |
| 01:34:45 | Argo scoped sync（PR #58） | operationState Succeeded，initiatedBy `gitadmin`，resources=[MinerU Deployment] |
| 01:34:47 | 新 RS `…mineru-75df5b8c8`、Pod `q522z` | readiness 5s 仍 timeout；随后 Unhealthy 事件 |
| ~01:38 | 紧急 scale MinerU → 0 | events：RS `75df5b8c8` 1→0；Pod `q522z` 删除 |
| 01:37:44–01:40:11 | PR #59（replicas 1→0）校验 | `jhnrm` Succeeded（7 tasks）；head `1c9a66ac` |
| ~01:45 | PR #59 合并 | merge `face37dbe674e3109d02d178f7c4864e69ba4c6e`；分支删除 |
| 01:46:11–01:47:24 | PR #59 main push 校验 | `6rhjw` Succeeded（`face37dbe`） |
| 01:47:55 | Argo scoped sync dry-run | `.operation.sync.dryRun=true`，resources=仅 MinerU Deployment，prune=false |
| 01:48:35 | Argo scoped sync（正式） | phase Succeeded，initiatedBy `admin`，revision `face37dbe` |
| 01:48:53–01:49:32 | 授权并行工作流直接 apply autoscale16 渲染 | 见第 5 节；Dagster 镜像替换、MinerU 模板 patch |
| 01:56:41 | A3 `npu-smi` 核验 | 16 chip Health=OK；NPU 0–7（chips 0–15）无运行进程 |

## 3. 根因细节

生产 Git 合并前的 MinerU 渲染（`environments/production/k12-data-pipeline/release.yaml`
@ `face37dbe`，行号约 583–700）：

- Deployment 与 Pod template annotation：`huawei.com/Ascend910: "Ascend910-14,Ascend910-15"`；
- env `MINERU_PHYSICAL_DEVICES: "14,15"`；
- launcher ConfigMap：按该 env 解析物理卡 → logical id，并分别启动
  `mineru-vllm-server` 于 30001/30002；
- `resources.requests/limits`: `huawei.com/Ascend910: "2"`，`privileged: true`，
  hostPath 挂载 `/usr/local/Ascend/driver`、`/usr/local/dcmi`、`/usr/local/bin/npu-smi`；
- nodeSelector：`accelerator-type=module-a3-16`、`kubernetes.io/arch=arm64`、
  `kubernetes.io/hostname=a3-server-00`。

缺陷合同：

1. 启动器信任静态设备，不读取调度后的实际 `huawei.com/Ascend910`/`AscendReal`；
2. privileged + 宿主设备挂载使其可访问未分配物理卡（越权使用风险）；
3. 无 post-scheduling 校验、无 fail-closed、无自动 Stop；
4. readinessProbe 时间（1s/5s，PR #58）不是根因，也不能替代设备一致性门禁。

## 4. 停止与验证证据

- PR #59：单文件 `environments/production/k12-data-pipeline/release.yaml`，
  MinerU `spec.replicas: 1→0`（+1/-1）；head
  `1c9a66ac3f7f063deab90f0793f9998f521073ef`；merge
  `face37dbe674e3109d02d178f7c4864e69ba4c6e`。
- Tekton：`model-platform-config-validation-jhnrm`（PR #59）7/7 tasks
  Succeeded；`model-platform-config-validation-6rhjw`（main push）Succeeded。
- Argo CD Application `argocd/k12-data-pipeline`：scoped sync 前 dry-run + 正式各一次，
  resources 仅 `apps/Deployment k12/k12-platform-cpu-k12-clean-qa-pipeline-mineru`，
  `prune=false`，`ApplyOutOfSyncOnly=true`；`status.sync.revision=face37dbe…`；
  MinerU per-resource `Synced`（其余见第 5 节）；health `Healthy`。
- Kubernetes：MinerU Deployment `spec.replicas=0`，无 live/ready 副本，
  `generation=13, observedGeneration=13`；k12 仅剩 Dagster（2/2）与 CPU Ray
  head/worker；全集群 `huawei.com/Ascend910` 请求 Pod 数=0；
  `a3-server-00` Allocated Ascend910=0（allocatable 16）。
- A3 宿主机（`2026-09-18T01:56:41Z`）：`npu-smi info` 16 chip `Health=OK`，
  NPU 0–7（对应 chips 0–15）全部 `No running processes found`。
- Qwen Deployment：`0/0`，未触碰。

## 5. 并行工作流（用户授权，01:48 起）

用户确认 2026-09-18 01:48–01:49 的 autoscale16 变更为其授权并行工作，
不属于本次停止操作，也未经 GitOps 声明：

- 输入：`/tmp/k12-autoscale16-rendered.yaml`（root，01:48:48）、
  `/tmp/k12-autoscale16-source.tar.gz`（含 `autoscale_nojudge`、
  `device_mapping.py`、`qwen_pool.py`、Dagster job 等源码）；
- 直接写入：Dagster live 镜像替换为
  `…/kcc-data-pipeline@sha256:28647d11a2dfb40f3295812d064f3d78c4efbf740bc9b800a802e3e9aa1afa5d`
  （Git `face37dbe` 声明为
  `0.5.1-npu-smoke-3b51c26@sha256:430327a3…`）；MinerU pod 模板改为
  downward API `ASSIGNED_NPU_DEVICES=metadata.annotations['huawei.com/Ascend910']`、
  `MINERU_PHYSICAL_DEVICES: ""`，移除静态设备 annotation；新 RS `…mineru-77f966d555`；
- 影响：Dagster/MinerU/Qwen 三个 Deployment 相对 Git `face37dbe` 为 `OutOfSync`；
  MinerU 仍 0 副本，无 NPU Pod、无 Ascend 请求；
- 收敛要求：该实现必须经 kcc + `model-platform-config` PR、Tekton 校验、合并后，
  再用 scoped sync 使声明态一致；直接 apply 不得作为最终状态，也不得作为
  “已发布”证据写入 CURRENT-STATE。

## 6. 恢复门槛（重新启动 MinerU NPU 前必须全部满足）

1. 启动器改造（并行工作流已实现雏形，待审查与 GitOps 化）：
   - 不得信任静态 `MINERU_PHYSICAL_DEVICES`（含空值回退语义）；
   - 从 Pod 实际 `huawei.com/Ascend910`/AscendReal 分配或安全的 device-plugin
     可见设备推导可用物理卡；
   - 静态声明、实际 annotation、容器可见设备三者不一致时必须退出，不启动 vLLM；
   - 保留 A3 `module-a3-16` nodeSelector 与 Volcano，不得修改全局
     Volcano/KubeRay 配置；
   - 加入调度后实际分配校验与失败自动 Stop。
2. 代码、Helm lint/render、Tekton 策略校验通过并合并；镜像以不可变 digest 固定。
3. 完成上述门禁后，向用户单独申请新的 NPU 启动授权。
4. 启动后先验证：Pod Ready、分配与实际设备一致、A3 `npu-smi` 无未授权设备进程；
   三者通过后才可发起唯一 batch_id 的 10 文档 MinerU Dagster smoke。
5. smoke 成功后 finalize、质量校验、停止到零副本；之后才继续 Stage 1、
   Qwen Stage 2、训练 JSONL 与 Backstage 完整集成。

## 7. 参考

- `k12-pr2-full-pipeline-execution-plan-20260917.md`
- `../CURRENT-STATE-20260917.md`
- `../tekton/running-gate-and-first-controlled-start-20260828.md`
- `k12-cpu-backstage-cutover-record-20260828.md`
