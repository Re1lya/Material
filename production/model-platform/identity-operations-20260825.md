# 平台自动化身份与凭据运维

本文记录模型平台的持久化机器身份。凭据值不得提交到 Git、CI 日志、诊断包或 Backstage 前端；只记录 Secret 名称、用途和最小权限。

## Gitea GitOps 写入身份

| 项目 | 值 |
| --- | --- |
| 机器人账号 | `model-platform-writer`（Gitea `bot`） |
| 唯一仓库权限 | `gitadmin/model-platform-config`：`write` |
| Token scope | `write:repository` |
| Kubernetes Secret | `gitea/model-platform-writer-credentials` |
| Secret 键 | `username`、`token` |
| 责任标签 | `app.kubernetes.io/part-of=model-platform`、`app.kubernetes.io/component=gitops-writer` |

该机器人用于提交受审查的 GitOps 请求；Argo CD 仍使用只读身份拉取仓库。管理员身份只用于创建、授予仓库权限、轮换或撤销机器人 token，不能用于日常提交。

轮换：创建新 token 写入同一 Secret，验证该机器人可 `ls-remote` 和推送到该唯一仓库后，撤销旧 token。需要在受控变更窗口内进行；不得把 token 作为命令行参数、URL、提交内容或日志输出。

## Artifact Keeper 身份

| 使用者 | 持久化引用 | 权限边界 |
| --- | --- | --- |
| 模型运行时/缓存 Job | `model-serving/artifact-keeper-model-runtime` 的 `token` | 仅读取 `model-artifacts` |
| ModelScope importer/受控发布任务 | `AK_PUBLISHER_TOKEN_FILE` 挂载的发布 token | 仅向批准的 Artifact Keeper 仓库写入制品 |
| 镜像拉取 | `model-serving/artifact-keeper-image-pull` | 仅拉取内部镜像仓库 |
| K12 数据管线镜像发布 | Artifact Keeper Service Account `svc-k12-data-pipeline-publisher`；服务器端 root-only Docker config | 仅匹配 Docker 仓库 `container-images`；仅 `read`、`write` |

新增 Artifact Keeper 自动化身份必须遵循同一规则：一个工作流一个机器人/Secret、最小仓库权限、名称和轮换责任写入本文，且工作负载只引用 Secret 名称。禁止共用管理员 token 或将 token 放入 GitOps 清单。

### K12 数据管线 Docker 发布身份状态（2026-08-26）

已创建的 Artifact Keeper Service Account 为
`svc-k12-data-pipeline-publisher`，供 `server-00` 上的 K12 数据管线镜像构建/发布
使用。它不是 Kubernetes ServiceAccount，也不属于 Gitea；其预期持久化 Docker
凭据位置为：

```text
/etc/model-platform/registry-auth/k12-data-pipeline-publisher/config.json
```

该目录只应由 `root` 读取（目录 `0700`、配置 `0600`），不得复制到 Git、Kubernetes
Secret、终端历史或构建日志。

**当前状态：可用。**2026-08-26 已在受控窗口将后端从
`artifact-keeper-backend:1.6.0` 升级至 `1.6.4`（Helm revision 4）。仅 backend 以
Recreate 方式滚动更新；PostgreSQL、Web、PV/PVC 均未重建，更新后的数据库与制品存储
健康。

服务账号现有一枚专用发布 token，名称为
`server-00-k12-data-pipeline-docker-publisher`，无到期时间，权限仅为 `read`、`write`，
仓库选择器同时限定为 Docker format 和 `container-images`。它已从上述 root-only Docker
config 成功完成 `docker login`、对
`container-images/k12-data-pipeline:auth-probe-20260826-r2` 的无害 push，以及 pull
验证。不得记录 token 值、token ID 或 Docker config 内容。

早先 OCI 登录的 `401` 不是 Artifact Keeper 的认证功能缺失：自动化错误地让 `sudo -S`
和 Docker `--password-stdin` 共用标准输入，导致 Registry token 被 sudo 预读。后续涉及
Docker password stdin 的命令必须先独立完成 `sudo -v`，再使用 `sudo -n docker ...`
与单独的 root-only token 文件；两种凭据绝不能共用一条 stdin。

轮换步骤（受控变更窗口）：

1. 为同一 Service Account 创建第二枚 token，保留相同的 Docker/`container-images`/`read,write`
   选择器；token 只短暂写入 root-only 临时文件。
2. 先独立完成 sudo 认证，再用新 token 更新上述 Docker config；不得将 token 置于命令行、
   Git、Kubernetes Secret、日志或 shell history。
3. 对 `container-images/k12-data-pipeline` 执行一次无害的 digest/架构复核及 push/pull 验证。
4. 确认构建任务可使用新 config 后撤销旧 token，并仅记录轮换日期、token 名称和验证结果。

Docker 将认证材料以标准 `config.json` 形式保存；这是 Docker 的正常行为。此处以
root-owned `0700` 目录和 `0600` 文件作为服务器侧访问边界，不能复制到 Pod、共享目录或
GitOps 清单。

## 运行前检查

1. 确认所需 Secret 存在且标签/用途与本文一致，但不要打印其 data。
2. 确认机器人只具有目标仓库或制品仓库所需的最小权限。
3. GitOps 更改先提交 Gitea，再由 Argo CD Sync；不要手工 patch Crossplane XR 作为长期状态。
4. 完成后记录提交 SHA、Argo revision 和服务状态，不记录凭据值。

## Agent release bot 申请状态（2026-08-27）

用户要求为后续 Agent 另建 Gitea 与 Artifact Keeper 的 release 身份。该身份当前
**尚未创建**，不得把现有的 `model-platform-writer` 或
`svc-k12-data-pipeline-publisher` 擅自扩权、复制凭据或改成通用账号。

建议权限边界：

- Gitea：仅对明确列出的仓库创建分支、推送提交和创建 PR；不能直接写受保护的
  `main`、不能 merge、不能管理仓库或用户。
- Artifact Keeper：初始仅对 Docker `container-images` 授予 `read,write`；不授予
  `delete`、`admin` 或通配仓库。
- 凭据必须进入受控的 root-only 文件或 namespace-local Secret；Git 中只记录账号名、
  权限、引用位置、创建/轮换日期和验证结论。

开始创建前需由用户确认 Gitea 管理员身份与目标仓库清单。不得猜测或探测管理员密码。
