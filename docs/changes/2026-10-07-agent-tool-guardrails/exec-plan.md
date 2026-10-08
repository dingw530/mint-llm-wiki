# 执行计划：Agent 工具安全与重试边界加固

## 文档信息

- 状态：执行中
- 关联产品规格：[product-spec.md](./product-spec.md)
- 关联设计文档：[design-doc.md](./design-doc.md)
- 关联追溯：[traceability.md](./traceability.md)
- 变更标识：`2026-10-07-agent-tool-guardrails`

## 完成定义

- [ ] 所有有副作用的工具都经过服务端审批策略；批准、拒绝、过期和重放边界有集成证据。
- [ ] Mint 自有与 MCP 工具 Schema 通过有界且完整的发布/运行时校验。
- [ ] 重试由 `retrySafety` 与结构化错误共同控制；非幂等、未知结果调用不会自动重放。
- [ ] ToolExecutionService 主路径接入结构化审计日志；日志含稳定调用 ID、工具、耗时、结果码和安全参数摘要，敏感 canary 不落日志。
- [ ] UI 审批、AgentRun 恢复和原有 MCP/Wiki 工具链通过相应 Harness 证据。
- [ ] 每条 AC 的证据等级和不变量满足 `verification-plan.json`。

## 范围与保护路径

### 允许路径

- `server/agent-runtime/`
- `server/application/agent-runtime/`
- `server/application/tools/`
- `server/infrastructure/mcp/`
- `server/infrastructure/persistence/`
- `server/infrastructure/observability/`
- `server/migrations/`
- `server/bootstrap/agent-runtime.ts`
- `server/package.json`
- `package-lock.json`
- `server/**/__tests__/`
- `client/src/features/chat/`
- `client/src/services/`
- `client/src/types/`
- `electron/` 中与现有工具审批 IPC 合约直接相关的文件
- `scripts/` 中本变更的工具 Schema inventory 或日志验证 probe
- `docs/changes/2026-10-07-agent-tool-guardrails/`

### 保护路径

- `.harness/`
- `.claude/skills/`
- 既有其他 `docs/changes/` 目录及 README 索引
- `agent-eval/`、`plugins/`、`.agents/`、`.codex/`
- 与当前工具调用无关的 Electron 打包改动

## 前置条件

- 执行前复核 GitNexus impact：`ToolExecutor.execute`、`ToolPolicy`、`ToolRoundEngine.executeToolCallWithRetry`、`McpToolAdapter.validate`、`AgentRun` 持久化与恢复。
- 清点 `ToolRegistry.getAllDefinitions()` 中实际启用的内置工具和动态 MCP Schema，确保 strict schema 改动不造成未解释的兼容破坏。
- 查明 SQLite migration 当前最新编号和 AgentRun 持久化结构；migration 只新增调用 ledger 所需状态，不修改已有 Wiki 表。
- 已记录执行前工作区：agent-eval viewer、Wiki UI/CSS、文档索引、Electron 打包、java-server 删除、插件与架构产物均为既有变更；保护这些路径，不将其纳入本变更。

## TP 列表

### TP-001：审批元数据和服务端策略收敛

- 状态：已完成
- 关联：US-001、BR-001~003、DS-001、AC-001/002
- 主要产出：工具元数据契约、ToolPolicy、`write_file`/`wiki_ingest`/Bash/MCP 风险声明、审批集成测试、Chat 浏览器场景。
- Probe：`tool-execution-security`、`tool-approval-service`、AgentRun/SSE 客户端测试、`tool-approval-write-guard` browser AC。
- 证据：审批前后副作用计数、拒绝/过期/重放结果、浏览器截图与关键请求。
- 风险：所有 MCP 工具（包括只读调用）都会等待审批；这是本变更不以远端 `readOnlyHint` 授权的保守决定。

- GitNexus 影响审查：`ToolExecutor.execute`、`evaluateToolPolicy` 为 LOW；`ToolRoundEngine.executeToolCallWithRetry` 为 HIGH；`AgentRun` 为 CRITICAL。当前 TP 限定在元数据、策略、执行服务与测试，不改 AgentRun 持久化协议。
- 基线：Node `20.19.4`；`better-sqlite3` 加载通过；`npm run harness:test` 18/18 通过；Harness inspect 通过。

### TP-002：闭合 Schema 与 MCP 全量约束验证

- 状态：已完成
- 关联：US-002、BR-004 至 BR-006、DS-002、AC-003 至 AC-005
- 主要产出：Zod→JSON Schema 闭合/深度检查、MCP JSON Schema validator、工具目录 lint 和正反例测试。
- Probe：`tool-schema-contract`、`mcp-schema-validation`、`tool-input-cross-field`、服务端类型检查。
- 证据：工具目录逐个 schema 断言；未知字段、深层 Schema、enum、数组项和跨字段反例的测试结果。
- 风险：验证器对 Schema 方言支持范围必须显式化；不支持的 MCP Schema 应报错，不得忽略约束。

### TP-003：调用身份、幂等状态和安全重试

- 状态：已完成
- 关联：US-003、BR-007 至 BR-010、DS-003/004/005、AC-006 至 AC-009
- 主要产出：SQLite migration、ToolInvocation repository/service、稳定调用 ID、`retrySafety`、结构化错误和 ReAct 恢复处理。
- Probe：`tool-invocation-idempotency`、`tool-retry-policy`、`tool-outcome-unknown-smoke`、Wiki ingestion idempotency regression。
- 证据：同调用 ID 只执行一次；进程故障恢复结果；重试次数/结果分类；非幂等工具在 timeout/unknown 下调用次数不增加。
- 风险：文件系统与外部 MCP 不可与本地 ledger 原子提交；采用保守 unknown 状态，不承诺 exactly-once。

- 开始日期：2026-10-07
- GitNexus 影响复核：`ToolRoundEngine.executeToolCallWithRetry` 为 CRITICAL，三个直接调用者是批准恢复/流恢复路径；`AgentRun` 为 CRITICAL，不修改核心类，复用已有持久化 `tool_call_started`/`tool_call_finished` 恢复事实，并由独立 invocation ledger 防止同 ID 重放。

### TP-004：接通结构化工具调用日志并验证脱敏

- 状态：已完成
- 关联：US-004、BR-011~013、DS-006、AC-010/011
- 主要产出：必需的 `ToolAuditSink`、ToolExecutionService 主路径注入、安全审计摘要契约、递归脱敏器和日志测试。
- Probe：`tool-audit-log-integration`、`tool-audit-redaction`。
- 证据：注入日志 sink 捕获到的结构化记录；嵌套凭证、查询文本、URL 参数、正文和堆栈 canary 的无泄漏断言。
- 风险：不可复用 UI `getCallSummary()`，其中可能包含用户查询；默认只记录参数结构摘要。

### TP-005：全链路回归、Harness 验证与证据回写

- 状态：进行中（本地监听与 Chrome 启动/清理受环境 EPERM 阻塞）
- 关联：AC-001 至 AC-011
- 主要产出：执行记录、Harness artifacts、逐 AC 证据与偏差记录。
- Probe：Harness unit、browser-ac、coverage、boundary、相关集成、日志脱敏和 process-smoke。
- 证据：`.harness/runs/2026-10-07-agent-tool-guardrails/<run-id>/`、测试报告、Schema 约束测试结果、进程恢复结果和结构化日志 canary 报告。
- 风险：浏览器 mock 只能证明 UI 协议；审批和幂等必须另有 integration/process 观察工具副作用计数。

## 验证命令

局部验证按实现后的项目实际测试文件确定，候选命令：

```bash
cd server && npx vitest run application/agent-runtime/__tests__/tool-execution-security.test.ts
cd server && npx vitest run infrastructure/mcp/__tests__/mcp-tool-adapter.test.ts
cd server && npx vitest run agent-runtime/__tests__/react-loop-core.test.ts application/agent-runtime/__tests__/tool-approval-service.test.ts
cd server && npx vitest run application/agent-runtime/__tests__/tool-audit-log.test.ts infrastructure/observability/__tests__/tool-audit-redaction.test.ts
npm run harness:inspect -- --change 2026-10-07-agent-tool-guardrails
npm run harness:verify -- --change 2026-10-07-agent-tool-guardrails
```

最终还要按 Harness 配置运行 coverage、boundary、browser-ac 和 process-smoke；Node、原生依赖及浏览器服务按 `.claude/skills/sdd-harness-workflow/SKILL.md` 预检。上述是计划命令，未在规划阶段执行。

## 执行记录

### 规划交接

- 状态：Spec / Design / Plan 已完成；TP-001 进行中。
- 产出：`product-spec.md`、`design-doc.md`、`exec-plan.md`、`traceability.md`、`verification-plan.json`、`browser-scenarios.json`。
- 验证：Harness inspect 通过；Harness 自身测试 18/18 通过。
- 风险/偏差：现有工作区有多项不相关未提交改动；实现阶段必须按保护路径保留。

### TP-001：审批元数据和服务端策略收敛

- 状态：已完成
- 开始日期：2026-10-07
- 产出：`ToolApprovalMode` 元数据；写工具默认强制审批；HTTP/Bash/knowledge graph 条件审批；所有 MCP 调用审批；Bash 工作区上下文。
- 验证：最终定向回归 10 个 Vitest 文件 125/125 通过；server TypeScript typecheck 通过；相关文件 Prettier check 与 `git diff --check` 通过。MCP read 也验证了未批准不调用远端。
- 问题与处理：原测试把高风险 Bash `rm -rf ./build-cache` 视为允许，现改为审批要求；timeout 测试显式提供批准上下文以继续验证执行超时。
- 已知风险：重试引擎牵涉审批恢复；AgentRun 风险 CRITICAL，未获独立影响审查和测试前不扩展其持久化协议。

### TP-002：闭合 Schema 与 MCP 全量约束验证

- 状态：已完成
- 开始日期：2026-10-07
- 前置影响分析：GitNexus 刷新后，`BaseTool.getDefinition` 为 CRITICAL/lower-bound；`McpToolAdapter.validate` 为 LOW/lower-bound。`McpClientManager.cacheTools` 初查 CRITICAL，最终撤回其修改以免扩大变更影响。
- 方案：Zod v4 原生 JSON Schema 输出保留 constraints；直接依赖 Ajv 2020-12 与 `ajv-formats` 验证 MCP Schema；固定 object 递归关闭额外属性，typed record map 保留显式值 Schema。
- 产出：`json-schema-policy.ts`、`mcp-input-schema.ts`、Ajv direct dependencies、内置工具与 MCP Schema 验证、Wiki 跨字段验证。
- 验证：TP 组合定向回归 10 个 Vitest 文件 125/125 通过；server typecheck、Prettier 和 `git diff --check` 通过。

### TP-003：调用身份、幂等状态和安全重试

- 状态：已完成
- 产出文件：调用 ledger migration/repository、ToolExecutionService invocation 注入、ToolExecutor 安全重试与结构化错误、Wiki 摄入幂等键传递、repository/retry tests 和 `scripts/tool-outcome-unknown-smoke.mjs`。
- 验证：定向 Harness probes `tool-retry-policy` 与 `tool-outcome-unknown-smoke` 通过；process smoke 在副作用计数为 1 后注入进程退出，恢复为 `outcome_unknown`，拒绝重试，计数仍为 1。
- 风险/偏差：本地 ledger 不保证外部系统 exactly-once；未知结果使用 fail-closed 策略。

### TP-004：接通结构化工具调用日志并验证脱敏

- 状态：已完成
- 产出文件：结构化 `ToolAuditSink`、ToolExecutionService 主路径注入、调用身份/工具元数据/耗时/结果码/重试次数/参数结构摘要字段及集成测试。
- 隐私边界：logger sink 固定白名单输出；参数值、字段名、正文、异常原文与堆栈不进审计记录；sink 故障不会改变执行结果。
- 输出格式：开发环境日志使用单行可读格式；`AI_CHAT_LOG_FORMAT=json` 保持 JSON，其他环境默认 JSON。审计字段保持一致。
- 验证：`tool-audit-log-integration` 与 `tool-audit-redaction` probes 通过，敏感 canary 未落入捕获记录。

### TP-005：全链路回归、Harness 验证与证据回写

- 状态：进行中，等待允许本地监听和 Chrome 启动/清理的环境完成最终验收。
- 逐 AC Harness：运行 `2026-10-08T03-50-10-658Z-93574`；AC-001、AC-003 至 AC-011 PASS；AC-002 integration PASS。将 Playwright daemon cache 放到临时目录后，Chrome 仍以 `SIGABRT` 退出，进程清理返回 `kill EPERM`，browser probe 未能执行到页面。
- 完整 Harness：运行 `2026-10-08T03-46-05-065Z-88436`；unit 检查 1161/1165 通过，4 项监听 `127.0.0.1` 的测试因 `listen EPERM` 失败，Harness 在该 gate 停止。
- 额外验证：定向回归 13 个 Vitest 文件 129/129 通过；Harness 自测 18/18 通过；server typecheck、process-smoke、Prettier 和 `git diff --check` 通过。
- 环境复核：`lsof` 发现工作区 `client` 下的 Vite 进程监听 `[::1]:5800`；受限 shell 请求该地址仍连接失败。Playwright 启动 Chrome 触发 `SIGABRT`/`kill EPERM`；桌面浏览器桥接超时，内置浏览器不可用，未取得页面或交互证据。
- 下一步：在可运行 `npm run dev` 且允许 Chrome 启动/清理的环境运行 `node scripts/run-tool-guardrails-harness.mjs` 和完整 `npm run harness:verify -- --change 2026-10-07-agent-tool-guardrails`，回写最终结果。

## 交接

- 当前进度：四项工作流（审批、Schema、幂等/重试、脱敏日志）已转成 L2 规格、方案和任务计划。
- 下一步：TP-001 至 TP-004 已完成；在允许本地监听和 Playwright daemon cache 写入的环境完成 TP-005 的浏览器及完整 Harness 验收。
- 已知限制：当前环境禁止服务监听（`listen EPERM`），并阻止 Playwright 启动/清理 Chrome（`SIGABRT`/`kill EPERM`）；daemon cache 临时目录已绕过。AC-002 browser evidence 缺失，不能将本变更归档为已完成。
