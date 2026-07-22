# Ora Tauri Backend 同步对话记录

- 导出日期：2026-07-22
- 项目目录：`/home/ilya/Desktop/desktop`
- 最终分支：`feat/tauri-backend-sync`
- 最终提交：`7d67c1a feat(desktop): sync tauri backend capabilities`
- 推送目标：`origin/feat/tauri-backend-sync`

> 说明：本次对话前期使用 `$grilling` 连续确认设计决策，其中大量回复为“确认”“可以”“是的”。为避免制造不存在的逐字问题文本，本文保留关键用户原话，并将连续确认合并为最终决策。内部工具调用、认证信息和密码未导出。

## 1. 初始目标

用户提出：

> `$grilling desktop/apps/desktop/src-tauri` 现在没有逻辑，需要和 `desktop/apps/web/server` 保持一致，目前可能有一些逻辑放在 server，需要抽到 crates。server 设计之初是只针对单 project，现在要和 tauri 保持一致，支持完整功能。现在只完善 tauri，server 除非抽出公共逻辑否则不动。

随后进一步明确依赖注入方式：

> 新建 `createTauriTranspor`，`createContractsClient(createFetchTransport())`，通过这样注入，所有的后端 API 都新建一个 tauri command，一样把请求传递到 crates 的逻辑。

用户强调本次任务的核心：

> 这不是本次要考虑的事情，本次重点是让 server 端逻辑变薄，让 tauri 和 server 能力同步。

并明确排除项：

> 本次任务不涉及 `ProjectWorkContext`。

## 2. Grilling 阶段确认的最终方案

### 2.1 公共 Backend 边界

- 新建 `crates/backend`，crate 名为 `ora-backend`。
- `ora-backend` 负责：
  - SQLite bootstrap；
  - `SystemClock`；
  - 具体 Repository 与 Application Handler 组合；
  - transport-neutral 公共错误；
  - 一个可 Clone 的 `Backend` 门面。
- 公共能力限定为五组 CRUD：
  - Project；
  - Task；
  - Session；
  - Skill；
  - Agent。
- 共计 25 个 Backend 方法和 25 个 Tauri command。
- `ProjectWorkContext`、filesystem directory 和 health 不进入本次公共 Backend。
- Web Server 只在抽取公共逻辑时改动，已有 HTTP 路由行为保持不变。

### 2.2 Transport 注入

- `ContractTransportRequest` 保留完整原始 `request` DTO。
- Fetch transport 继续使用 HTTP path/body，并忽略该额外字段。
- Desktop 在 `apps/desktop/web` 提供 `createTauriTransport()`。
- Desktop 使用：

```ts
createContractsClient(createTauriTransport())
```

- Web 继续使用：

```ts
createContractsClient(createFetchTransport())
```

- 每个支持的 contract operation 映射到一个 snake_case Tauri command。
- Tauri command 接收完整 request DTO，并调用 `ora-backend`。
- Desktop 不再运行时依赖 mock service。
- Desktop 对以下操作明确返回 `unsupported_operation`：
  - `openProjectWorkContext`；
  - `renewProjectWorkContext`；
  - `listDirectory`。

### 2.3 Task 与 Project 关系

用户确认 CRUD 生成时没有纳入业务约束：

> 这个来源是因为生成 crud 的时候没有考虑业务逻辑，确认。

最终决定：

- Task 创建时根据请求中的 `projectId` 动态查询 Project。
- 使用该 Project 的 `rootPath` 作为 Git repository root。
- Task 删除时先根据 Task 查询其所属 Project，再选择正确的 Git repository。
- Task 不允许迁移到另一个 Project。
- 从 `UpdateTaskRequest` 移除 `projectId`。
- Web、Tauri、mock service 和 App Shell 同步更新该契约。

### 2.4 Worktree 路径规则

用户指出：

> 更新 worktree 根目录后原来的 worktree 就不能通过路径拼接得到，我们应该通过 git 命令解析得到 worktree 的路径。

并最终确认：

> 统一使用 git 解析得到路径，不再通过路径拼接。

最终规则：

- 配置中的 worktree root 只用于确定新 worktree 的创建目标。
- 新 worktree 仍可按 `<configured-root>/<task-id>` 生成目标路径。
- 已有 worktree 的真实路径绝不通过当前配置重新拼接。
- Worktree 数据库存储的 `branch_name` 是解析已有 worktree 的稳定标识。
- Gitlancer 解析 `git worktree list --porcelain` 的 branch metadata。
- 删除 Task 时，根据 branch name 从 Git metadata 找到权威 worktree 路径。
- 修改 worktree root 后，旧 worktree 不迁移，但仍能正常删除。
- 正在执行的创建操作使用启动时取得的 root 快照；配置更新只影响之后启动的操作。

### 2.5 Desktop 配置和存储

用户确认：

> 启动时生成的配置文件默认配置 worktree，仍然在 `app_data_dir` 下，等到用户第一次使用 app 时在页面上更改。

最终路径：

- Tauri identifier：`space.ora.desktop`；
- SQLite：`app_data_dir/ora.sqlite3`；
- 配置：`app_data_dir/config.json`；
- 日志：`app_data_dir/logs/ora.log`；
- 默认 worktree root：`app_data_dir/worktrees`。

配置规则：

- 首次启动自动创建版本化配置文件和默认 worktree 目录。
- 配置写入使用同目录临时文件进行原子替换。
- 损坏、无法解码、未知版本或非法配置会使启动失败，不静默重置。
- 用户选择的 worktree root 必须：
  - 是绝对路径；
  - 已经存在；
  - 是目录。
- 不要求目录为空，也不额外创建写入探针。
- worktree root 属于非敏感配置。

### 2.6 设置页能力建模

- `PlatformAdapter` 增加 discriminated capability：

```ts
type WorktreeStorageCapability =
  | { kind: "unsupported" }
  | {
      kind: "configurable";
      getRoot(): Promise<string>;
      setRoot(path: string): Promise<void>;
    };
```

- Web adapter 返回 `unsupported`，设置页不显示该入口。
- Tauri adapter 通过 Desktop-only commands 读取和更新配置。
- 设置入口放在已有的“数据与隐私”分类，不新增分类。
- 修改位置不会移动已有 worktree，UI 明确提示该行为。

### 2.7 错误与异步边界

- `BackendError` 统一公共错误 code/message。
- Web 根据 `BackendErrorKind` 增加 HTTP status。
- Tauri command 返回结构化 `{ code, message }`。
- Tauri frontend 转换为 `ContractTransportError`，其 `status` 为 `null`。
- Repository、SQLite、filesystem 等内部诊断不直接暴露给前端。
- 共享 Backend 保持同步 API。
- Tauri async commands 使用 blocking executor 调用同步 Backend。

### 2.8 日志与 workspace

- Desktop 使用 `ora-logging`，不再使用 `tauri-plugin-log`。
- 注册 Gitlancer logger bridge。
- 日志每日轮转，保留 3 天。
- Debug 构建写 stdout 和文件；Release 构建只写文件。
- Logging guard 由 Tauri managed state 保持整个进程生命周期。
- `apps/desktop/src-tauri` 保持独立 Cargo workspace 和独立 `Cargo.lock`。
- 根 `Taskfile.yml` 必须显式运行 Desktop Rust 检查。

## 3. 实施结果

### 3.1 新增 `ora-backend`

新增 `crates/backend`，包含：

- `Backend` 与 `BackendPaths`；
- SQLite bootstrap 和 RepositoryPool 所有权；
- Project、Task、Session、Skill、Agent 的具体 Handler 组合；
- 25 个显式 CRUD 方法；
- 公共错误归一化；
- 动态 worktree creation root；
- Task create/delete 的 Project-aware Git 路由。

Web Server 删除了原先五组重复 service 组合，HTTP handlers 现在直接委托 `AppState.backend()`。

Web-only 的 filesystem 和 `ProjectWorkContext` service 保持原样。

### 3.2 Git worktree 权威解析

Gitlancer 的 `WorktreeHandle` 增加可选 `branch_name`。

`git worktree list --porcelain` parser 解析：

```text
branch refs/heads/<branch-name>
```

新增 `resolve_worktree_by_branch`，Task worktree 删除及创建失败补偿均使用 branch metadata 定位实际 worktree。

测试覆盖了修改 creation root 后仍能删除旧 worktree 的场景。

### 3.3 Tauri Rust Runtime

新增：

- `commands.rs`：25 个 CRUD commands 和 2 个 Desktop config commands；
- `config.rs`：版本化配置、校验和原子持久化；
- `error.rs`：bootstrap 与 command 错误；
- `state.rs`：Backend、ConfigStore 和 LoggingGuard；
- 重写 `lib.rs`：启动配置、日志、Backend 和 invoke handler 注册。

所有 CRUD commands 都通过 Tauri blocking executor 调用同步 `Backend`。

### 3.4 Tauri Frontend Transport

新增 `createTauriTransport()`：

- 完整映射 25 个 operation name 到 Tauri command；
- 原样传递 contract request DTO；
- 标准化 Rust command error；
- 显式拒绝三项排除操作；
- 未识别操作返回稳定的 unsupported error。

Desktop `App.tsx` 改为注入真实 Tauri transport，不再使用 mock transport。

### 3.5 Desktop 设置

- `PlatformAdapter` 增加 worktree storage capability。
- Tauri adapter 调用 `get_desktop_config` / `set_worktree_root`。
- Web adapter 明确标记为 unsupported。
- “数据与隐私”设置页支持：
  - 显示当前 worktree root；
  - 打开原生目录选择器；
  - 保存新位置；
  - 显示加载、保存和错误状态。
- 增加中英文文案。

### 3.6 Contracts 和生成器

- `ContractTransportRequest` 增加完整 `request` 字段。
- Contracts Client 在构造 transport request 时保留原始 DTO。
- `UpdateTaskRequest` 移除 `projectId`。
- 修复 `cargo xtask export-contracts` 重复执行时，ts-rs 类型被重复追加的问题。
- 生成器现在只清理带 ts-rs generated header 的文件，不碰手写 client、transport 和 index。

### 3.7 文档和任务入口

- 新增 `docs/desktop-runtime.md`。
- 更新 `docs/application-contracts.md`。
- 更新 `docs/web-server-runtime.md`。
- README 增加 Desktop Runtime 链接。
- 新增 `task test:desktop`，执行：
  - Desktop transport tests；
  - Tauri Rust formatting check；
  - Tauri Rust Clippy；
  - Tauri Rust tests。
- 根 `task test` 显式包含 `test:desktop`。

## 4. 测试与审计

实施过程中发现并修复：

1. Web Task route 测试仍依赖不存在的固定 `project-1`，改为先创建真实 Project，以验证动态 Project 路由。
2. App Shell 和 mock service 的 Task update mock 仍从已移除的 `request.projectId` 读取项目，改为保留原 Task 所属 Project。
3. Tauri `get_desktop_config` 的 Rust 参数一度命名为 `_request`，会导致 frontend `{ request: {} }` 参数名不匹配，改为正式的 `request` 参数。
4. 非法 worktree root 曾可能短暂写入 Backend，改为先校验再激活。
5. 合约生成器重复执行产生重复 TypeScript 声明，修复为幂等导出。
6. Clippy 发现 Task create 中一个不再需要的 `PathBuf::clone()`，已移除。

最终通过：

- `cargo test --workspace`；
- `cargo clippy --workspace -- -D warnings`；
- Contracts tests；
- Platform tests；
- App Shell tests；
- Mock Service tests；
- Desktop transport tests；
- Desktop TypeScript production build；
- Desktop、Platform、Web frontend lint；
- `cargo xtask export-contracts` 重复生成；
- `git diff --check`。

## 5. Tauri Linux 环境配置

独立 Tauri Rust crate 初次检查被系统缺少以下开发包阻止：

- `libwebkit2gtk-4.1-dev`；
- `libjavascriptcoregtk-4.1-dev`；
- `libsoup-3.0-dev`。

系统运行库已经存在，但当前账户无法通过非交互 sudo 安装系统包。因此最终采用无需 root 的用户级方案：

- 将 Debian 开发包及 libsoup 所需开发元数据解压到：
  - `/home/ilya/Desktop/.local/ora-tauri-deps/sysroot`
- 在 `/home/ilya/.cargo/config.toml` 配置：
  - `PKG_CONFIG_PATH`；
  - `PKG_CONFIG_SYSROOT_DIR`。
- 复用系统已有 WebKitGTK、JavaScriptCoreGTK 和 libsoup 运行库。

配置完成后，独立 Tauri crate 实际通过：

```text
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
task test:desktop
```

Tauri 配置模块的 4 个单元测试全部通过：

- 首次生成默认配置；
- 保存并重新加载用户选择的 worktree root；
- 拒绝相对路径和不存在的目录；
- 拒绝损坏的配置文件。

## 6. Git 提交与推送

用户要求：

> 帮我 commit 和 push 一下。

随后确认应使用 feature branch：

> 我现在是符合 commit 要求的吗，开一个新分支 feat 然后再提交啥的。

最终执行：

- 从 `main` 创建：`feat/tauri-backend-sync`；
- 使用 Conventional Commit：

```text
7d67c1a feat(desktop): sync tauri backend capabilities
```

- 推送至：`origin/feat/tauri-backend-sync`；
- 未推送到 `upstream`；
- 保留并排除用户已有的：
  - `AGENTS.md` 修改；
  - `acp_v1_session_modes_slash_commands_extensibility.md` 未跟踪文件。

PR 创建地址：

```text
https://github.com/Re1lya/desktop/pull/new/feat/tauri-backend-sync
```

## 7. 建议的 PR 描述

建议标题：

```text
feat(desktop): sync Tauri backend capabilities with web runtime
```

描述重点：

- 新增共享 `ora-backend`，让 Web/Tauri 共用业务组合；
- Tauri 增加 25 个 typed CRUD commands；
- Desktop 注入 `createTauriTransport()`；
- Web Server 五组 CRUD 变薄；
- Desktop 增加配置、日志和 worktree storage 设置；
- 已有 worktree 路径统一从 Git branch metadata 解析；
- `UpdateTaskRequest` 不再允许修改 Project；
- 明确说明 `ProjectWorkContext`、filesystem 和移动已有 worktree 不在本次范围；
- 列出 Rust、Frontend、Desktop 和生成器验证结果。

## 8. 最终状态

本次目标已完成：

- Web Server 公共 CRUD 逻辑已抽到 crate，HTTP adapter 明显变薄；
- Tauri 与 Web 在五组核心 CRUD 上使用同一个 Backend；
- Desktop frontend 使用真实 Tauri transport；
- Desktop 持久化、配置、日志和 worktree root 设置已实现；
- 修改 worktree root 不会破坏旧 worktree 的定位和删除；
- 独立 Tauri Rust workspace 已真实编译、lint 和测试通过；
- 功能分支已经 commit 并推送。
