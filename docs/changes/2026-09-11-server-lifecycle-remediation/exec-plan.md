# 执行计划：启动与关闭生命周期整改

## 完成定义

TP-1 到 TP-5 全部完成；`ServerRuntime` 成为 Node、CLI、Docker、Electron 的统一生命周期边界；所有 AC 有对应测试或 runtime 证据；Harness unit、coverage、boundary、browser-ac（显式不适用）以及 lifecycle/process-smoke claim probes 全部通过；traceability 和本文件记录完整。

## 前置条件

- 当前工作树已有用户创建的 [生命周期整改方案](../../architecture/server-lifecycle-remediation.md)，本变更将其落实为实现规格。
- 保持 Node 20.19.4 / 项目脚本要求的 Node 版本。
- 修改前检查 `git status`，不覆盖无关工作区改动。
- 代码修改前对 `server/index.ts`、`server/app.ts`、CLI、Electron bootstrap 和后台服务做影响分析。
- 不修改 `.harness/`、`.claude/skills/`、Vitest 配置和无关产品功能。

## Harness 交接边界

### 允许路径

- `docs/changes/2026-09-11-server-lifecycle-remediation/`
- `docs/technical-and-product-planning-debt.md`
- `docs/architecture/server-lifecycle-remediation.md`
- `server/app.ts`
- `server/index.ts`
- `server/electron-bundle.ts`
- `server/runtime/`
- `server/cli/`
- `server/docker-entry.js`
- `server/services/api/memoryJobService.ts`
- `server/services/api/wikiIngestionJobService.ts`
- `server/services/api/wikiLifecycleService.ts`
- `server/services/api/mcpService.ts`
- `server/services/observability/langfuse.ts`
- `server/db.ts`
- `server/routes/`
- `server/__tests__/`
- `server/services/**/__tests__/`
- `electron/main.js`
- `electron/services/`
- `scripts/`

### 受保护路径

- `.harness/`
- `.claude/skills/`
- `vitest.config.ts`
- `server/vitest.config.ts`
- `client/vitest.config.ts`
- `server/services/tools/ToolExecutor.ts`
- `server/services/toolRoundEngine.ts`
- `server/services/reactLoopCore.ts`
- `server/services/adapters/`
- `client/`
- `package-lock.json`（除非实现明确需要依赖变更）

本变更无浏览器用户流程；`browser-scenarios.json` 使用空场景明确声明 browser-ac 不适用。Electron smoke 通过 runtime/命令行证据验证，不新增 Playwright/Electron 测试依赖。

## 任务计划

### TP-1：消除 import 副作用

- 状态：已完成
- 关联：DS-001；AC-001
- 计划产出：`server/app.ts`、`server/index.ts`、Wiki ingestion 初始化路径及对应测试。
- 工作：`app.ts` 只组装 Express；删除 `index.ts` import-time auto-start；将 MCP、Memory、Wiki lifecycle 和 Wiki queue 启动移出模块导入。
- 验证：import smoke、server startup tests、CLI serve 单启动测试。
- 执行记录：2026-09-11 完成。移除 app/index import-time 启动副作用；启动测试与监听边界测试通过。

### TP-2：建立 ServerRuntime

- 状态：已完成
- 关联：DS-002；AC-003、AC-004
- 计划产出：`server/runtime/`、启动状态、资源 registry、启动回滚和 runtime 单元测试。
- 工作：引入 `created/starting/running/stopping/stopped` 状态；持有 HTTP server；实现幂等 start/shutdown 和共享 deadline。
- 验证：状态机、重复 start/shutdown、startup failure rollback、端口监听测试。
- 执行记录：2026-09-11 完成。新增 ServerRuntime 状态机、幂等 start/shutdown、启动失败回滚和统一资源关闭 deadline；runtime 定向测试通过。

### TP-3：接入后台服务关闭协议

- 状态：已完成
- 关联：DS-003；AC-005、AC-006
- 计划产出：Memory、Wiki queue、Wiki timer、SSE、MCP、Langfuse、SQLite 的生命周期适配及测试。
- 工作：增加 stop/idle/close 入口；统一关闭顺序；确保 worker 停止后 SQLite 才关闭。
- 验证：顺序 spy、关闭超时、活跃任务、活跃 SSE、MCP 和数据库 close 测试。
- 执行记录：2026-09-11 完成。接入 AgentRun cancelAll、Memory/Wiki worker、HTTP/SSE 连接、MCP、Langfuse、SQLite 关闭协议；验证取消先于 HTTP 连接关闭。

### TP-4：统一 Node/CLI/Docker/Electron 入口

- 状态：已完成
- 关联：DS-004；AC-002、AC-007、AC-008
- 计划产出：Node、CLI、Docker、Electron 入口适配和退出信号处理。
- 工作：显式传递 runtime/listen mode；修复 CLI 双启动；接入 Electron before-quit；保留 Docker 0.0.0.0 和本地 loopback 语义。
- 验证：入口单启动、SIGINT/SIGTERM、Electron production/dev smoke、Docker smoke。
- 执行记录：2026-09-11 完成。Node、CLI、Docker、Electron 复用统一 runtime；监听模式显式区分并拒绝同进程混用；入口与边界测试通过。

### TP-5：回归、Harness 和证据回写

- 状态：已完成
- 关联：DS-005；AC-004、AC-008、AC-009
- 计划产出：定向测试报告、Harness 证据、exec-plan/traceability 执行记录、最终验证摘要。
- 工作：运行环境预检、局部测试、完整 Harness、typecheck/lint/build/diff check；修复当前范围内失败并回写证据。
- 验证：`npm run harness:verify -- --change 2026-09-11-server-lifecycle-remediation` 及最终 `--writeback`。
- 执行记录：2026-09-11 完成。Harness unit、browser-ac 空场景、coverage、boundary 全部通过；`npm test`、`npm run lint`、`npm run build`、`npm run verify:source` 和 `git diff --check` 全部通过。
- 执行记录：2026-09-13 完成。根据 Evidence Contract 补齐后台任务 drain、关闭顺序、显式启动模式和真实进程探针；修复 Dockerfile workspace/运行依赖缺失。Harness run `2026-09-13T13-51-51-717Z-7598` 的 8 个检查全部通过，AC-001～AC-009 全部 PASS。

## 风险与依赖

- Electron 主进程退出事件需要防止重复触发；实现必须使用退出锁。
- SSE 连接可能阻止 HTTP server 优雅关闭；必须有主动取消或连接集合证据。
- Memory 与 Wiki queue 当前调度模型不同；本变更只接入生命周期，不合并调度实现。
- 若发现需要修改受保护路径或新增产品行为，暂停当前 TP，更新 SDD 后再继续。

## 验收证据矩阵

| AC     | 预期证据               | 验证方式         | 状态   |
| ------ | ---------------------- | ---------------- | ------ |
| AC-001 | import 无启动副作用    | unit/static      | 已验证 |
| AC-002 | Node/CLI/Docker 单启动 | unit/integration | 已验证 |
| AC-003 | runtime 状态和幂等操作 | unit             | 已验证 |
| AC-004 | 启动失败回滚           | unit/integration | 已验证 |
| AC-005 | 停止新任务并等待/超时  | unit/integration | 已验证 |
| AC-006 | 固定关闭顺序           | unit/integration | 已验证 |
| AC-007 | Electron 退出接入      | runtime/manual   | 已验证 |
| AC-008 | Docker/loopback smoke  | runtime          | 已验证 |
| AC-009 | 全量工程验证           | Harness          | 已验证 |

### 2026-09-11：Harness run 2026-09-11T10-46-00-659Z-90393

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-11-server-lifecycle-remediation/2026-09-11T10-46-00-659Z-90393
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed
