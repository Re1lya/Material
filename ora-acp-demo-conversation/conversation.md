# Ora ACP Demo 对话记录

- 导出日期：2026-07-22
- 项目目录：`/home/ilya/Desktop/desktop`
- 最终分支：`demo`
- 最终提交：`4a36845 feat(agent): add direct ACP session runtime`
- 推送目标：`upstream/demo`

> 说明：本次对话前期包含大量 grilling 问答，部分早期上下文已被系统压缩，无法逐字恢复所有助手提问。本文保留当前可见的用户原话，并按确认结果整理完整决策、实施、审计和交付记录。连续的“确认”已合并，避免制造并不存在的逐字转录。

## 1. 初始目标

用户提出：

> `$grilling` 我们现在赶进度，要做个 demo 出来，本来打算设计的插件模块现在暂时先不做，由 ora 进程直接通过 process crate 创建 opencode 子进程（nga/codeagentcli 也要支持），然后通过 stdio 进行通信，三者都是通过 opencode/nga/codeagentcli acp 命令启动。项目有两种形态，web 和 tauri，我想给 ContractTransport 加上一个新的方法，初步想法：

```ts
export type ContractCallOptions = {
  signal?: AbortSignal;
};

export interface ContractTransport {
  send<TResponse>(request: ContractTransportRequest): Promise<TResponse>;
  send<TResponse>(request: ContractTransportRequest, options?: ContractCallOptions): Promise<TResponse>;
  stream<TEvent>(request: ContractTransportRequest, options?: ContractCallOptions): AsyncIterable<TEvent>;
}
```

用户随后确认 `packages/chat` 可以任意重构，因为当前只有 mock 功能。

## 2. Grilling 阶段确认的最终方案

### 2.1 CLI 与进程模型

- Ora 直接持有 ACP 子进程，不再等待插件模块。
- 三种 CLI 均使用单个 `acp` 参数启动：
  - `opencode acp`
  - `nga acp`
  - `codeagentcli acp`
- 每个 Ora Session 对应一个串行 actor，同一 Session 同时只能执行一个 load 或 prompt。
- 不同 Session 可以并发运行。
- `AgentCli` 在 Session 创建后不可变。
- OpenCode、NGA、CodeAgentCLI 分别定义独立的路径函数，即使当前目录结构相似也不共用一个路径函数。
- 用户明确要求：

> 代码写死，家目录找 opencode。

- 最终路径约定：
  - `~/.opencode/bin/opencode`
  - `~/.nga/bin/nga`
  - `~/.codeagentcli/bin/codeagentcli`
- NGA 和 CodeAgentCLI 本轮只定义标识和路径，不做环境测试，因为当前环境没有这两个工具。

### 2.2 Agent Definition 澄清

用户纠正了早期歧义：

> agent definition 是 agent.md 的意思，不是你说的这个意思。

并确认：

> demo 完全不会用到 agent definition。

因此 Session 的 agent 选择改为 `AgentCli`，不使用 Agent Definition 作为运行时路由。

### 2.3 cwd 解析

用户明确要求：

> cwd 查询路径应该是：task 得到 worktree_id，然后查询得到 branch name，然后通过 git 得到 worktree 路径作为 cwd。

最终解析链路：

```text
Task
  -> worktree_id
  -> Worktree.branch_name
  -> Project.root_path
  -> Git worktree metadata
  -> authoritative cwd
```

已有的 worktree 创建根目录不能用于反推 Session cwd。

### 2.4 Session 生命周期

- Create：启动进程，调用 `initialize`，再调用 `session/new`；只有全部成功后才持久化 Ora Session。
- 私有的 provider session ID 存入 `agent_session_id`，不暴露给前端。
- Load：启动新进程，调用 `initialize`，再调用 `session/load`。
- 用户明确要求：

> demo 直接用 acp 的 load session 方法，sessionid 参数就是 agentSessionId。

- 应用启动时，数据库中遗留的 Running Session 统一改为 Stopped，因为 Ora 重启后不可能继续持有旧子进程。
- 点击左侧 Stopped Session 时，右侧自动加载 provider 历史：

> 点击左侧停止的 session，右侧要展示对话历史，这一步就会自动 load，demo 先这样做。

- Session 删除会先停止进程，然后只删除 Ora 自己的记录，不删除 provider 历史。

### 2.5 Prompt、取消与权限

- Prompt demo 仅支持文本。
- `AbortSignal` 会一路传到运行时并转换为 ACP `session/cancel`。
- 取消后保留已经收到的 assistant 部分输出，并标记为 stopped。
- Prompt 期间可以收到 `session/request_permission`。
- UI 展示权限选项，并通过独立 unary API 回应。
- 用户要求后台 Session 收到权限请求时在左侧显示提醒图标：

> 左边收到权限请求的后台 session，左侧展示提醒图标。

### 2.6 数据流和控制流

用户明确要求：

> 数据流和控制流要分开，队列溢出不能丢数据。

最终规则：

- ACP session update 走有界数据队列，容量 256。
- permission 和 fatal error 走独立控制队列。
- 队列溢出必须显式失败并终止相应连接，不能静默丢帧。
- ACP 与 Web NDJSON 单帧最大 8 MiB。
- Contract stream 是 cold stream，并且只能消费一次。

### 2.7 Web 与 Tauri transport

- Web 使用 NDJSON 流。
- Tauri 使用 `Channel`。
- 两者都实现：

```ts
export interface ContractTransport {
  send<TResponse>(
    request: ContractTransportRequest,
    options?: ContractCallOptions,
  ): Promise<TResponse>;

  stream<TEvent>(
    request: ContractTransportRequest,
    options?: ContractCallOptions,
  ): AsyncIterable<TEvent>;
}
```

- Tauri 前端消费队列同样限制为 256，溢出返回 `stream_queue_overflow`。
- Mock transport 不再模拟 ACP stream。
- 用户明确要求：

> MockAcpClient 直接丢弃不用。

### 2.8 删除语义

用户先考虑 Git 级联删除，随后改变决定：

> 我改变想法了，级联删除完全不碰 git。

最终规则：

- Session 删除：停止进程并软删除 Ora Session。
- Task 删除：若没有 Running Session，则事务性软删除 Task、Worktree 记录和 stopped Sessions。
- Project 删除：若没有 Running Session，则事务性软删除 Project、Tasks、Worktree 记录和 stopped Sessions。
- 所有级联删除完全不调用 Git。
- 若存在 Running Session，返回 `resource_in_use`。
- 本次不做强制删除 UI：

> 强制删除需要用户在界面上确认，本次不做，只提醒无法删除。

- 用户确认系统尚未投入使用，没有旧数据，因此允许直接修改 baseline schema，不做兼容迁移。

## 3. 实施结果

### 3.1 新增 ACP crate

新增 `crates/acp`：

- NDJSON JSON-RPC peer
- request ID 关联
- 8 MiB 帧限制
- bounded update queue 与独立 control queue
- EOF 唤醒 pending requests
- 未知 agent-originated request 返回 JSON-RPC `-32601`，并继续连接

### 3.2 Backend Agent Runtime

新增 `crates/backend/src/agent_runtime`，后续按仓库模块大小规范拆分为：

- `mod.rs`：manager 与公共运行时编排
- `actor.rs`：Session actor 状态机
- `paths.rs`：三种 CLI 的独立路径函数
- `stream.rs`：可取消的业务事件流

支持：

- create
- load
- prompt
- cancel
- permission response
- stop
- delete
- stale Running reconciliation
- Git authoritative cwd resolution

### 3.3 Contracts 与 transport

- 增加 `ContractCallOptions.signal`
- 增加 typed stream endpoints
- Fetch transport 支持 NDJSON、取消、帧校验和 single-use
- Tauri transport 支持 Channel、取消注册和 bounded consumer queue
- Rust contract 导出器同步生成 TypeScript endpoint metadata

### 3.4 Chat 与 UI

- 移除 `MockAcpClient`
- Chat Store 直接依赖生成的 contracts client
- load 使用 staging，只有 Completed 后原子替换历史
- 依据 ACP `messageId` 组合消息 chunk
- prompt append、取消保留 partial output
- 权限卡片与左侧提醒图标
- 点击 Stopped Session 自动 load
- prompt 完成或连接失败后刷新 Session 状态

### 3.5 数据库与业务约束

- Session 使用不可变 `AgentCli` 和必填 `agent_session_id`
- Session 更新只允许变更 lifecycle 状态
- Task/Project cascade 使用 SQLite `BEGIN IMMEDIATE`
- create Session 使用 guarded insert，防止 ACP 握手期间 Task 被删除
- Project root 和关键关联保持不可变
- mock service 与真实后端保持相同的 `resource_in_use` 行为

## 4. 最终审计及额外修复

用户要求：

> 再检查一下是否完全符合最终方案，是否还有简单的错误。

审计发现并修复：

1. 用户取消带 pending permission 的 prompt 后，Chat Store 没有清除权限提醒。
2. Session 删除与并发 load 之间存在重新启动已删除 Session 的竞态。
3. `session/new` 握手期间 Task 被软删除后，Session 仍可能写入已删除 Task。
4. ACP stdio 已断开时，prompt error/cancel 路径可能把死亡进程重新放回 actor。
5. provider 连接失败后 UI 可能仍显示旧 Running 状态。

对应修复：

- 取消 prompt 时清空 pending permissions。
- load/prompt/permission/stop 注册与 Session 删除使用同一 lifecycle gate。
- Session 删除的停止和软删除收进 runtime manager。
- Session insert 增加 visible Task 条件。
- 仅在 ACP 连接仍可复用时保留进程。
- prompt 结束后刷新 Session query。

提交前又根据仓库规范将超过 800 行的 runtime 模块拆分，未改变行为。

## 5. 验证结果

完整执行并通过：

```text
task test
```

包含：

- TypeScript lint 与 contract generation
- contracts tests：13 passed
- chat tests：3 passed
- platform tests：11 passed
- app-shell tests：50 passed
- mock-service tests：11 passed
- ACP tests：2 passed
- application tests：30 passed
- DB tests：25 passed
- Web server tests：36 passed
- Desktop transport tests：5 passed
- Desktop Rust tests：4 passed
- workspace Clippy with -D warnings
- cargo fmt
- git diff --check

## 6. OpenCode 冒烟测试

环境中的 OpenCode：

```text
/home/ilya/.opencode/bin/opencode
version 1.18.4
```

真实 `opencode acp` 测试结果：

- `initialize` 成功。
- 直接发送与 OpenCode ACP 示例相同的 `session/new` 请求：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/absolute/repository/path",
    "mcpServers": []
  }
}
```

- OpenCode 1.18.4 自身返回：

```text
-32603 OpenCode service failure: { service: "directory" }
```

- 临时 Git 仓库、带初始 commit 的临时仓库和当前项目仓库均可复现。
- 该请求绕过 Ora 直接发送，因此判断为当前 OpenCode runtime/environment 问题，而不是 Ora transport 或 cwd 解析问题。
- OpenCode ACP 参考：https://github.com/anomalyco/opencode/issues/8680

冒烟测试产生的临时目录已清理。

## 7. 提交与推送

用户要求：

> 帮我进行提交和推送，按照规范进行。

执行结果：

```text
branch: demo
commit: 4a36845 feat(agent): add direct ACP session runtime
remote: upstream/demo
```

首次 push 被本地代理 `127.0.0.1:7890` 阻止。随后只为该次 push 临时清除代理环境变量，没有修改全局 Git 或系统代理配置，推送成功：

```text
c7eebc1..4a36845  demo -> demo
```

用户文件 `acp_v1_session_modes_slash_commands_extensibility.md` 未纳入提交。

Commit 链接：https://github.com/ora-space/desktop/commit/4a36845

## 8. 建议的 PR

### Title

```text
feat(agent): add direct ACP session runtime
```

### Body

```markdown
## Summary

- add a direct ACP runtime that launches OpenCode, NGA, or CodeAgentCLI as child processes
- communicate with agent CLIs over JSON-RPC/NDJSON stdio
- support session create, load, prompt, cancellation, permission responses, stop, and deletion
- add streaming transports for Web and Tauri
- replace the mock chat client with contract-backed session streams
- add transactional Ora-only cascade deletion without modifying Git state

## Motivation

The demo needs real agent sessions before the planned plugin system is available.

Ora now owns the ACP child-process lifecycle directly. Each persisted Ora session has one serialized runtime actor, while different sessions can run concurrently.

## Implementation

### Agent runtime

- launch each provider with its `acp` command
- resolve the executable from its provider-specific path under the user home directory
- resolve `cwd` through Task → Worktree → branch → Git worktree metadata
- call `initialize` followed by `session/new` when creating a session
- call `session/load` with the persisted provider session ID when reopening history
- keep provider session IDs private to the backend

### Streaming and flow control

- use NDJSON response streams on Web
- use Tauri Channels on Desktop
- add abortable, cold, single-consumer streams to `ContractTransport`
- separate high-volume session updates from control messages
- bound data queues to 256 items and fail explicitly on overflow
- reject frames larger than 8 MiB
- propagate frontend cancellation to ACP `session/cancel`

### Persistence and deletion

- make the selected agent CLI and provider session ID immutable
- mark stale running sessions as stopped during startup
- prevent session creation from racing deletion of its owning task
- serialize session deletion against new runtime operations
- reject Task or Project deletion while descendant sessions are running
- cascade only Ora database records; Git branches and worktrees are never deleted

### UI

- automatically load provider history when a stopped session is selected
- retain partial assistant output after cancellation
- render permission requests in the conversation
- show a permission indicator for background sessions
- refresh persisted session status after prompt completion or failure

## Breaking changes

This replaces the previous mock/plugin-oriented session model and updates the baseline SQLite schema.

No compatibility migration is included because the application has not been deployed and there is no existing user data to preserve.

## Validation

- `task test`
- `cargo clippy --workspace -- -D warnings`
- `cargo fmt --all`
- Desktop Tauri transport and Rust tests
- ACP framing and request-correlation tests
- database cascade and deleted-task race tests
- chat history, cancellation, and permission-state tests

## Known limitation

OpenCode 1.18.4 successfully responds to the ACP `initialize` request in the current environment, but its `session/new` implementation returns:

`-32603 OpenCode service failure: { service: "directory" }`

The same failure occurs with a direct ACP request outside Ora, using both a temporary Git repository and the project repository. The request shape matches the documented OpenCode ACP example, so this appears to be an OpenCode runtime/environment issue rather than an Ora transport failure.
```

## 9. 最终状态

- 代码已实现、复查、测试、提交并推送。
- `demo` 与 `upstream/demo` 指向同一提交 `4a36845`。
- 未创建 PR；当时按现有共享 `demo` 分支直接推送。
- 工作区仅剩用户自己的未跟踪 ACP 文档。
