# 产品规格：启动与关闭生命周期整改

## 背景与目标

Mint 的 Node HTTP、CLI、Docker 和 Electron 入口目前共享服务模块，但启动行为分散在模块导入、副作用定时器和各入口脚本中。Memory、Wiki ingestion、Wiki lifecycle、MCP、SSE、Langfuse 和 SQLite 也没有统一的资源所有权与关闭顺序。

本变更将启动与关闭收敛为显式、可测试的 `ServerRuntime` 生命周期，消除 import-time side effect 和 CLI 双启动风险，并保证进程退出时按顺序释放资源。

## 用户与场景

- US-001：作为 Mint 开发者，我希望 import 服务模块不会隐式监听端口或启动后台任务，以便测试、CLI 和 Electron 可以明确控制启动。
- US-002：作为 Mint 运维者，我希望 Node、CLI、Docker 和 Electron 使用一致的启动/关闭契约，以便端口、后台任务和外部连接不会重复或泄漏。
- US-003：作为 Mint 用户，我希望应用退出或重启时正在运行的 SSE、队列、MCP 和数据库资源得到有界清理，减少数据丢失和残留进程。

## 功能要求

- FP-001：提供 `createApp()`，只负责 Express 组装，不在 import 阶段启动资源。
- FP-002：提供 `ServerRuntime`，统一持有 HTTP server、后台 worker、queue、timer、MCP、SSE/AgentRun、Langfuse 和 SQLite 资源。
- FP-003：`start()` 和 `shutdown()` 幂等，并在启动失败时按已创建资源逆序回滚。
- FP-004：Node、CLI、Docker、Electron development/production 使用显式 runtime mode，不依赖 `AI_CHAT_CLIENT_DIST` 推断是否启动。
- FP-005：关闭时停止新请求和新任务，等待当前任务或超时后按固定顺序释放资源。
- FP-006：保留 Node/Electron loopback、Docker container listen 和现有 IPC 行为。

## 范围

### 做

- 消除 `app.ts`、`index.ts` 和服务单例的 import-time 启动副作用。
- 引入 server runtime 与启动状态。
- 为 Memory、Wiki queue、Wiki lifecycle、MCP、SSE、Langfuse 和 SQLite 接入生命周期协议。
- 修复 CLI、Docker、Electron 的入口调用和退出路径。
- 增加启动失败、信号退出、活跃 SSE、队列任务和 Electron/Docker smoke 验证。

### 不做

- 不重写 repository/service 分层。
- 不更换 SQLite、MCP 或队列实现。
- 不把 Electron 改为独立 server 子进程。
- 不重写 AgentRun 业务状态模型。
- 不在本变更中统一所有异步任务为同一种队列实现。

## 业务规则

- BR-001：模块 import 不得监听 HTTP 端口、创建长期 timer、启动 worker 或建立 MCP 连接。
- BR-002：同一个 runtime 实例最多启动一次；重复 `start()` 返回既有启动结果。
- BR-003：同一个 runtime 实例最多执行一次 shutdown；重复调用复用同一个 Promise。
- BR-004：shutdown 先停止新任务和新连接，再等待当前任务，SQLite 必须晚于后台 worker 关闭。
- BR-005：每个可等待的关闭步骤必须有有限超时；超时必须记录资源名和继续退出的结果。
- BR-006：Node/CLI 默认监听 loopback，Docker 保持 container listen，Electron development 不重复启动外部 server。
- BR-007：启动中途失败必须释放已经成功创建的资源，并保留原始失败原因。

## 非功能要求

- NF-001：不改变现有 HTTP API、SSE 数据格式、Electron IPC endpoint 契约和数据库 schema。
- NF-002：启动和关闭日志不得包含 API Key、Authorization、消息正文或向量内容。
- NF-003：shutdown 在正常退出路径应有明确完成日志；超时或失败不得静默吞掉。
- NF-004：新增生命周期方法符合 TypeScript 类型约束、项目依赖方向和 JSDoc 约定。

## 验收标准

- AC-001：import `server/app.ts` 和 `server/index.ts` 不会自动监听端口、启动 MCP、Memory worker、Wiki queue 或 Wiki lifecycle timer。
- AC-002：CLI `serve`、Node 入口和 Docker 入口各只启动一个 HTTP server；端口冲突不会由重复启动逻辑掩盖。
- AC-003：`ServerRuntime.start()`、`ServerRuntime.shutdown()` 可重复调用且不会重复创建、重复关闭或抛出非预期错误。
- AC-004：启动任一阶段失败时，已创建的 HTTP、timer、worker、queue、MCP 和数据库资源按逆序清理，并保留失败原因。
- AC-005：shutdown 时停止新 HTTP/SSE/AgentRun/后台任务，等待当前任务或达到超时后继续执行后续资源关闭。
- AC-006：关闭顺序满足 worker/queue → SSE/HTTP → MCP → Langfuse → timer → SQLite；每一步都有可测试的调用证据。
- AC-007：Electron production 在 `before-quit`/退出路径等待 runtime shutdown；Electron development 不启动重复的内嵌 HTTP server。
- AC-008：Docker smoke 能验证启动、API 请求、SIGTERM、退出码和端口释放；Node/CLI/Electron loopback 约束不回归。
- AC-009：现有 server/client/agent-eval 测试、typecheck、lint、build、boundary 和 Harness 检查通过。

## Harness 验收边界

本变更不修改用户界面和用户交互流程，`browser-scenarios.json` 显式声明 browser-ac 不适用。Electron smoke 属于进程级 runtime 验证，不用浏览器场景替代。

## 风险与依赖

- 依赖 better-sqlite3、sqlite-vec、Electron native module 的当前 Node ABI；验证环境必须使用项目要求的 Node 版本。
- 现有模块级单例可能被测试直接引用；迁移必须保留兼容出口或同步调整允许范围内的测试。
- SSE 和 AgentRun 可能长时间运行；shutdown 的等待上限需要明确，不能无限等待。
- 现有 TD-022 的多套异步调度问题与本变更相关，但本变更只建立生命周期接入，不承诺一次性统一调度原语。
