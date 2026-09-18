# K12 PR #2 全链路数据管线与 Backstage 集成执行计划

> 文档类型：执行计划、发布门禁和验收合同。
>
> 业务基线是 [`zzzYesYes/kcc` PR #2](https://github.com/zzzYesYes/kcc/pull/2)，
> head `2fd605cfe572470f582c4ef9575a5382dd6f9ff2`。本计划补充
> `k12-platform-integration-plan-20260827.md`：后者定义目标架构和平台化原则，本文
> 定义从 2026-09-17 实际生产基线继续完成完整业务链路的发布顺序。
>
> 密码、Token、Secret data、kubeconfig 和私有数据内容不得进入本文或相关提交。

## 1. 目标与完成定义

完成的主线是以下受控链路，而不是任意 Kubernetes/Ray 参数的通用控制台：

```text
数据湖 ingest / manifest
  -> MinerU NPU 文档解析
  -> CPU Stage 1 清洗
  -> Qwen NPU Stage 2 QA
  -> 质量校验、版本化 manifest、训练 JSONL
  -> Backstage 显示请求、进度、产物和失败原因
```

每个阶段必须从 Backstage 的受限任务目录选择，后端只提交已审阅的 Dagster job 与
profile。运行环境、镜像 digest、NPU 资源、Bucket 合同和并发上限仍由 GitOps 配置；
CPU 业务 run 不改 GitOps。由于现有 MinerU job 只探测既有服务、不会自行拉起零副本
Deployment，MinerU 的启动/停止是唯一例外：它必须通过固定模板生成受约束的 GitOps
请求，再经既有 Tekton/人工 Argo 门禁生效。用户级权限扩展、审计告警和通用多租户调度不在本主线范围，
但现有允许发起者检查不得移除。

用户已明确将验收范围扩大为 **PR #2 的完整功能集**，不能以仅 CPU 清洗或“主线”
子集作为完成声明。除上述连续链路外，平台必须受控接入并测试 PR 中的 MinerU
`submit`、`finalize`、既有 batch 注册、Stage 1 全量/兼容 profile、Qwen lifecycle、
chat、2 NPU 与 8 NPU Stage 2 sample/full、资产 job、textbook demo、E2E demo 和训练
JSONL 结果。一个能力可以复用已验收 profile 或作为下游阶段运行，但不得只停留在
Backstage 的只读目录中。

“完整集成完成”须同时满足：所有上述功能存在受限的平台入口、对应 Dagster job 与
运行合同可用、每个资源 profile 至少有一次成功验收或已审阅的等效覆盖测试；完整小样本
从输入到训练 JSONL 成功；每一步具有隔离输出与版本 manifest；质量验证可阻止不合格
产物；NPU 工作负载在完成/失败后回到零副本；Backstage 能显示 run ID、阶段状态、
产物位置和可执行的失败建议。

## 2. 已验证基线

截至 2026-09-17：

- `k12-data-pipeline` 已 `Synced/Healthy`；Dagster `1/1 Ready`，CPU Ray head/worker
  Ready；MinerU 与 Qwen Deployment 均为零副本。
- 已部署 Dagster 能发现 PR #2 的 MinerU、Stage 1、Stage 2、Qwen lifecycle 等 job；
  当前 Backstage 仅允许 `cleanjopbstage1_10` 的受限 CPU 启动。
- `cleanjopbstage1_10` 有历史 Backstage 成功与近期 CPU 成功证据，但本次同步后尚未有
  新的 Backstage 会话验收。
- 集群可分配 Ascend910，但任何 NPU 启动仍须在对应阶段进行容量、镜像、配置和
  scale-to-zero 验收；现有 MinerU/Qwen profile 都以 2 NPU、零副本为基线。
- PR #2 的 `mineru_smoke_10_job` / `mineru_submit_job` 会先检查既有 MinerU A/B
  服务，当前不会伸缩 `mineru` Deployment。因此不能把它直接暴露为 Backstage 的
  Dagster launch；需要先提交受限的 MinerU GitOps start request、等待 Ready，完成后
  再按同一受限路径回收至零副本。
- 原始 PDF 输入前缀和既有 CPU manifest 均存在；`k12-textbook-meta` 对 pipeline
  身份不可读，属于 ingest 服务的职责边界。Backstage 只可引用已登记的 raw 批次/
  manifest，不应取得元数据或采集凭据。

生产实时细节见 `../CURRENT-STATE-20260917.md`。不得从 PR 中的旧 smoke 配置或文档
推断当前 NPU 已可直接发布。

## 3. 执行顺序（2026-09-17 调整）

后续不再以 Backstage 页面或 API 的完成度作为数据管线完成度。工作严格分为两个串行
workstream：**A. 数据管线本体** 完成且取得生产验收证据后，才进入 **B. Backstage/
GitOps 集成**。现有 Backstage 本地代码、Tekton gate 和 Material 计划仅作为 B 的准备
工作，全部保持默认关闭，不能阻塞或替代 A。

### A. 先完成数据管线本体

1. 固定并验证 raw batch、manifest、hash/数量、错误清单和输出隔离合同。
2. 验证 MinerU：2 NPU runtime 启动、Ready、10 文档 smoke、full submit、finalize、既有
   batch 注册、产物/summary 校验、失败恢复以及完成/失败后的零副本回收。
3. 验证 Cleaning：从上述 MinerU batch 实际输入运行 Stage 1 sample、full、兼容 smoke 和
   兼容 full，检查上游关联、质量和 resume。
4. 验证 Qwen/Stage 2：2 NPU lifecycle、模型探测、chat、sample/full，再独立完成 8 NPU
   lifecycle、sample/full、容量和零副本回收。
5. 验证产物：assets、textbook demo、E2E demo、训练 JSONL、质量报告与从 raw batch 到
   JSONL 的版本 manifest。
6. 完成 A 的回归：顺序成功、受控失败、重试、无残留 NPU Pod、全部输出可追溯。只有这些
   证据齐全，才称“PR #2 数据管线本体完成”。

### B. 再完成 Backstage/GitOps 集成

1. 将 A 中已验收的每个 profile 逐一做成 allow-listed Backstage entry，而非让浏览器传入
   Bucket、镜像、NPU 或 Kubernetes 参数。
2. 发布并验收 MinerU/Qwen 的 GitOps start/stop request、Tekton 静态/容量 gate 与人工
   Argo sync；通过后才开启对应 launch 开关。
3. 接入 run 状态、产物 manifest、失败建议、质量报告和从输入到 JSONL 的链路视图。
4. 对每个入口重跑其已验收 profile，并验证并发拒绝、权限边界和成功/失败后的缩零。

## 4. 发布阶段

| 阶段                   | 交付内容                                                                                                                     | 发布/运行边界                                                                                                                                    | 验收门禁                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1. 任务目录与观测      | Backstage 显示 PR #2 的数据湖、MinerU、Stage 1、Stage 2、JSONL 任务及 Dagster 最近 run；仅 CPU Stage 1 可启动                | **不启动 NPU、不修改生产配置**                                                                                                                   | 前后端测试通过；目录准确反映运行 job；未知/未启用任务无法通过 API 发起。 |
| 2. 数据湖与 manifest   | 受限 ingest/manifest profile、输入批次状态及可选小样本提交                                                                   | 仅已批准 Bucket/Prefix；不覆盖已有 batch                                                                                                         | 原始数据、manifest、hash/数量和错误清单均可读；失败不推进后续阶段。      |
| 3. MinerU NPU          | 只读预检、固定 GitOps start/stop request、2 NPU 小样本 profile、容量/镜像/服务健康检查、提交、进度、finalize 和输出 manifest | 单一 allow-listed profile；最多一个活动 MinerU run；启动/停止走 Tekton 与人工 Argo，同步后才由 Backstage 提交 Dagster；成功/失败均 scale-to-zero | 解析结果、失败隔离、resume、输出摘要和零 NPU 回收全部通过。              |
| 4. Stage 1 衔接        | 从 MinerU 已完成输出选择受限 Stage 1 输入，保留现有 CPU 资源合同                                                             | 不接受浏览器传入的 Ray/Kubernetes 参数                                                                                                           | 新 Backstage run 成功，输出完整且与 MinerU batch/source 关联。           |
| 5. Qwen Stage 2        | Qwen 2 NPU 与 8 NPU lifecycle、健康/模型探测、chat、Stage 2 sample/full、自动质量检查和停止                                  | 2 NPU 先验收，随后 8 NPU profile 也必须完成独立容量、功能和回收验收；两者均属于本次范围                                                          | 两种 profile 的 Stage 2 摘要/校验通过、失败可定位、Qwen 回到零副本。     |
| 6. 训练 JSONL 与结果页 | 训练 JSONL、质量报告、版本/输入输出 manifest 和 Backstage 链路视图                                                           | 仅消费已通过 Stage 2 的结果                                                                                                                      | 能从源 batch 追溯到 JSONL；不合格数据不会标记为可用。                    |
| 7. 全链路回归          | 端到端小样本、失败重试、并发拒绝、回收和 Material 发布记录                                                                   | 人工 Argo 同步继续；prune/self-heal 保持关闭                                                                                                     | 每阶段 Success、无遗留 active run/NPU Pod、输出隔离且证据归档。          |

## 4.1 PR #2 完整能力验收清单

| 能力组               | 必须完成的平台接入与测试                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Data lake            | ingest/manifest、raw 批次状态、选择受限输入、错误清单与 hash/数量核验。                                     |
| MinerU               | 2 NPU start/ready/submit/smoke/full/finalize、已有 batch 注册、进度/输出 manifest、失败或成功均缩至零副本。 |
| Cleaning             | Stage 1 sample、full、兼容 smoke/full 均有受控 profile 与可查询结果；上游 MinerU 产物关联可追溯。           |
| Qwen / QA            | 2 NPU lifecycle、chat、Stage 2 sample/full，以及 8 NPU lifecycle、sample/full 的独立容量和回收验收。        |
| Integration / output | asset job、textbook demo、E2E demo、训练 JSONL、质量报告和从输入 batch 到输出的链路视图。                   |

## 5. Backstage 集成详细设计（本次开发）

第一阶段只改变 Backstage 本地源码：

1. 后端提供固定任务目录，映射到生产 Dagster 已暴露的 job；任务分为 data-lake
   ingest、MinerU parse/finalize、CPU Stage 1、Qwen Stage 2、训练 JSONL 结果。
2. `/status` 与 `/runs` 返回目录和目录内 job 的最近运行记录，使用户能看见已有
   MinerU/Qwen/Stage 2 作业，而非只看 CPU Stage 1。
3. 前端展示任务阶段、计算类型、NPU 数量、依赖和启用状态。只有既有 CPU Stage 1
   按钮保持可用；其他任务明确显示“未启用”，不存在绕过门禁的 POST API。
4. 任务目录本身不读取 Secret、不放宽 Backstage ServiceAccount 权限、不允许浏览器提交
   镜像、Pod、Ray、NPU、Bucket 或并发参数。

第一阶段完成后才开始第二/三阶段的配置与 NPU 小样本设计。任何 MinerU/Qwen 发布前均应
先完成服务器端 dry-run、精确 GitOps diff、镜像 digest/架构核验、目标节点容量检查，并
在用户确认后执行人工 Argo 同步。

### 5.1 进行中的集成实现

本地 Backstage 源码现已加入只读 MinerU Deployment 预检，以及受限的 MinerU
start/stop Gitea PR action。后者只会在 `release.yaml` 中把固定 Deployment 的
`spec.replicas` 从 `0` 改为 `1` 或从 `1` 改为 `0`；它拒绝其他当前状态，且不会重写
镜像、NPU 设备、资源、Secret 或 Bucket 配置。

该 action 目前显式 `enabled: false`。配置仓库的本地开发已补入 K12 专用 Tekton
validator：静态 validator 验证 PR 分支、唯一变更文件、唯一 Deployment、副本转换和
已核定镜像/资源/节点/设备合同；只读容量 validator 则在启动请求上检查 `a3-server-00`、
NPU 14/15 的可分配数、Pod 占用、设备健康及活跃进程。两者均尚未发布到生产 Tekton，
因此不是生产验收证据。先经配置仓库 PR、受限身份的集群验证和人工 Argo sync 后，才可
启用 action；Ready 之前 Backstage 不得提交 MinerU Dagster job。

Backstage 本地开发也已实现唯一的 MinerU 启动 API：固定为
`mineru_smoke_10_job`、`k12-mineru-smoke-10-v1`、10 文档、2 个 MinerU service、
核定的 raw 输入前缀和每请求独立 `production/mineru/backstage-smoke/<request>` 输出。
该 API 会检查 Dagster、固定 MinerU Deployment 是否 Ready，并拒绝已有 active MinerU
run；默认同样为 `mineruLaunchEnabled: false`。它不是全量提交、finalize、既有 batch
注册或 Qwen/Stage 2 的替代入口，后续阶段必须分别按完整能力清单实现。即使有人误开
`mineruLaunchEnabled`，API 仍要求受限 GitOps action 的 `mineruGitops.enabled` 同时开启。

## 6. 追踪与文档规则

- 每一阶段创建独立的 release record，记录非敏感的 Git revision、image digest、输入/
  输出 manifest、Dagster run ID、资源 profile、时间、验收和回滚点。
- `CURRENT-STATE-*` 只写实时已观察事实，不把本计划、源码或 dry-run 写成已上线。
- 失败的 NPU 小样本应保留诊断证据和输出隔离信息，随后按合同缩容；不得通过删除
  Bucket、PVC、历史 run 或宽泛 Kubernetes 清理来“恢复绿色”。
