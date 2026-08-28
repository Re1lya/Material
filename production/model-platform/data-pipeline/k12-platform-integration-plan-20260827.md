# K12 数据管线平台工程化集成方案（修订版）

> **文档类型：目标方案与验收合同。**
>
> 2026-08-28 实施状态：CPU 阶段已按本方案完成 Tekton、Artifact Keeper、
> GitOps、Dagster/Ray CPU、状态迁移、Backstage 受限启动和旧服务切换。
> NPU 阶段未因 CPU 集成自动启用。当前事实见 `../CURRENT-STATE-20260828.md`，
> 实施证据见 `k12-cpu-backstage-cutover-record-20260828.md`。

**原始业务源码基线：** `zzzYesYes/kcc` PR #2，head commit
`2fd605cfe572470f582c4ef9575a5382dd6f9ff2`。生产 KCC 后续已通过受审 PR 演进；
精确生产 commit 以对应发布记录为准。

## 1. 决策

K12 已有的数据管线、Dagster Job、manifest、MinIO 数据合同、进度文件、hash、失败隔离和
resume 语义是唯一的业务实现。平台工作不另建替代性“CPU staging”业务管线，也不部署空
Dagster foundation 作为长期中间态。

应交付一套由 GitOps 管理的**完整 K12 正式发布单元**，并在受控窗口替换当前手工维护的
`k12/mineru-dagster`。这不是重写或分叉业务管线：PR #2 的源码和既有 K12 运行语义保持
连续；变化的是源码治理、镜像供应链、配置、身份、部署和平台入口。

## 2. 不采用的路线

- 不将 `production/model-platform/data-pipeline/image/platform_control_plane` 的空 Definitions
  作为正式交付物；它仅可保留为历史验证材料，不能成为生产 K12 服务。
- 不维护第二份平台自有的 `cpu-staging-v1` 业务处理实现。
- 不直接对当前手工 Deployment 逐项 patch 到平台标准；其 HostPath 源码、root S3 身份、
  宽泛 RBAC 和无版本发布方式会造成不可审计的混合状态。
- 不直接安装 PR #2 原始 Helm Chart：它必须先适配现有 MinIO、Artifact Keeper、GitOps 和
  集群资源治理，不能再创建第二个数据湖或沿用历史主机路径/凭据。

## 3. 目标架构

```text
K12 PR #2 源码（唯一业务实现）
  -> 生产 Gitea 镜像仓库（精确 commit）
  -> K12 专用 Tekton CI：测试、Dagster import、Helm/Kustomize render、策略检查、构建
  -> Artifact Keeper：K12 镜像的不可变 digest
  -> Gitea model-platform-config 发布 PR
  -> 人工 Argo CD Sync
  -> GitOps 管理的完整 K12 Dagster + CPU pipeline release
  -> Backstage：K12 Job/run config 的受限入口、状态和审计
  -> Dagster -> 既有 MinIO 数据合同；后续按批准 Profile 接入 KubeRay/NPU
```

K12 业务输出继续保存在现有 `k12-lake` MinIO；Artifact Keeper 只保存镜像和可追溯制品，
不保存原始 PDF、处理中间件或训练 JSONL。

## 4. 发布单元的设计

### 4.1 源码和 Job

- 将 PR #2 的精确 commit 导入/镜像到生产 Gitea 的 K12 仓库；K12 仓库是业务源代码真相，
  Material 只保存平台 overlay、策略和发布记录。
- 在 **K12 源码内**补充 `platform` profile，不复制业务逻辑。profile 选择既有 K12 CPU
  Job/asset 和既有 manifest contract；NPU Job 的注册、可见性和可启动性由同一源码中的
  profile 与批准配置控制。
- 基础集成阶段只发布已验证的 CPU 路径。NPU 并非另一条管线：它是同一 K12 release 的后续
  RuntimeProfile，必须在 CPU 验收后单独批准。

### 4.2 镜像和 CI

- Tekton 对精确 40 位 commit 执行 K12 原有单测、Dagster Definitions import、Helm render
  和平台策略检查。
- 先交付完整 K12 AMD64 CPU 镜像；未来 NPU runtime 使用单独的 ARM64/Ascend 镜像和
  RuntimeProfile，不能把 NPU 依赖伪装进 CPU 控制面镜像。
- 每次成功构建只发布 Artifact Keeper 的不可变 digest，并创建环境配置 PR；CI 不直接修改
  Kubernetes，也不处理真实数据。

### 4.3 集群和状态

- 最终正式服务保留在 K12 业务边界内，建议以 `k12` namespace 和稳定服务入口为目标，
  避免形成长期并行的第二套数据管线。
- 将源码从 HostPath 移入镜像；Dagster run/history state 迁移到版本化、可备份的专用 PVC 或
  明确迁移后的持久化后端。切换前必须对现有状态作只读备份和恢复演练。
- 复用现有 `k12-lake` MinIO 和既有数据前缀；不重建 bucket、不重写历史数据、不改变
  manifest/output 合同。
- 将 root S3 凭据替换为最小权限的 K12 runtime identity。权限以业务所需 prefix 为准，而非
  为新管线另定义数据格式。

### 4.4 Backstage 和运行边界

- Backstage 展示当前 K12 release、Dagster runs、Tekton build、Argo revision 与 MinIO
  输出摘要。
- 表单只映射到 K12 源码中已定义且通过平台审核的 Job/run config；浏览器不能传入镜像、
  HostPath、Kubernetes YAML、Ray 参数或 NPU 数量。
- 初期可使用 Git-only run request 作为审计门；稳定后由后端调用 Dagster 的受限启动接口。
  两种入口都指向**同一 K12 Job**，而非替代 Job。

## 5. 受控切换而非双管线过渡

不能在正在运行的 HostPath Deployment 上直接拼接新旧模式。正确切换方式是：

1. 以 PR #2 同一业务源码构建完整平台 release；
2. 在不修改旧 K12 运行语义的情况下完成 CI、镜像、配置渲染和状态迁移演练；
3. 在发布窗口暂停新的旧任务、确认无 active run、备份 Dagster state；
4. 发布 GitOps 管理的完整 K12 release，并将稳定服务入口切到新 release；
5. 用历史兼容的 CPU smoke manifest 验证读写、progress、_SUCCESS、失败重试和 resume；
6. 连续观察成功后，受控退役旧 Deployment 的 HostPath 源码和旧宽泛权限。

并行验证若存在，只用于切换前的短期技术验收；它不产生第二份业务代码、第二个数据湖或
长期双写。正式切换后平台只保留一个 K12 管线。

## 6. 必须补齐的工程工作

1. 审计 PR #2 与现网 `k12/mineru-dagster` 的 Job 名称、run config、S3 prefix、环境变量、
   Dagster state 和 Service 行为，形成兼容性映射。
2. 将 PR #2 合并或镜像至生产 Gitea，并在 K12 源码中实现 platform profile；不得在 Material
   复制业务 Definitions。
3. 为完整 K12 release 建立 Tekton CI、Artifact Keeper 镜像发布和 GitOps PR 流程。
4. 将 PR #2 Chart 适配为平台 overlay：外部 MinIO、受控 Secret 引用、无 HostPath 源码、
   无重复 MinIO、无未经批准的 NPU 默认值。
5. 设计并演练 Dagster state 迁移、服务入口切换和回滚；回滚以恢复旧 digest/Deployment 和
   state snapshot 为准，不删除数据或 bucket。
6. 发布 Backstage 页面：它是 K12 已批准 Job 的目录和受限启动入口，不是新的编排系统。
7. 用既有 K12 CPU 数据样本完成兼容性验收后，才讨论同一 release 的 Ray/MinerU/Qwen
   RuntimeProfile、容量、设备所有权和审批策略。

## 7. 验收标准

- 同一 K12 manifest 在旧环境和新 release 上得到兼容的输入标识、进度、成功标记和输出摘要；
- 新 release 的代码 commit、镜像 digest、Tekton run、Argo revision 和 Dagster run 可相互追溯；
- 不存在第二个 MinIO、第二份业务代码或长期双写路径；
- Backstage 只能启动审核过的 K12 Job/run config；
- 旧 HostPath 源码、root S3 使用和 Deployment patch 权限在切换验收后被移除；
- NPU 没有因为 CPU 集成而自动启用。
