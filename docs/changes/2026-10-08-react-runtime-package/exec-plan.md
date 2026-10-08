# 执行计划：可移植的最小 ReAct 框架包

## 文档信息

- 状态：已完成
- 变更标识：`2026-10-08-react-runtime-package`
- 关联：[product-spec.md](./product-spec.md)、[design-doc.md](./design-doc.md)、[traceability.md](./traceability.md)

## 完成定义

- [x] `@mint/react-runtime` 独立构建、导入、打包；运行时代码不依赖 Mint。
- [x] 假模型/假工具通过最小 ReAct 核心完成多轮工具循环与终答。
- [x] 最大轮次、取消、未知工具和工具错误都有明确边界。
- [x] Mint 生产 `runAgentChat` 使用新框架适配层，既有外部行为通过回归验证。
- [x] 示例可在无真实 API Key 和 Mint 数据库时运行。
- [x] AC 的证据等级满足 `verification-plan.json`。
- [x] `@mint/tool-runtime` 提供可独立使用的 registry/runtime；Mint 生产执行通过 adapter 使用它。

## 范围与保护路径

### 允许路径

- `packages/react-runtime/`
- `packages/tool-runtime/`
- `package.json`、`package-lock.json`
- `server/package.json`
- `server/agent-runtime/`
- `server/application/agent-runtime/tooling/`
- `server/application/agent-runtime/tool-execution-service.ts`
- `server/application/agent-runtime/tool-round-engine.ts`
- `server/bootstrap/agent-runtime.ts`
- `server/application/agent-runtime/` 中直接适配所需文件
- `server/**/__tests__/` 中直接相关测试
- `scripts/run-react-runtime-harness.mjs`
- `docs/changes/2026-10-08-react-runtime-package/`
- `docs/product-specs/README.md`
- `docs/design-docs/README.md`
- `docs/exec-plans/README.md`

### 保护路径

- `.harness/`、`.claude/skills/`
- 其他 `docs/changes/` 与文档索引
- client、electron、agent-eval、plugins、MCP 工具实现和现有 migration
- 已存在的所有未提交变更；除 workspace 配置外不触碰本功能无关文件

## 前置检查

- 已确认仓库为 `mint-ai-chat`，当前提交 `404c876`，工作区有多条未提交改动。
- GitNexus 对 `reactChat` 的已索引调用图报告 CRITICAL 和大量受影响流程；索引针对 `404c876` 且比当前工作区落后，因此只作为风险提示，必须结合源码测试。
- 实现前复核 `reactChat`、`executeReactRun`、`runAgentChat` 和审批续跑调用路径；保留 `runAgentChat` 兼容边界。
- 不新增数据库 migration，不将审批、AgentRun 持久化、A2UI 或 Wiki 类型放入框架包。

## TP 列表

| TP     | 目标                             | 状态   |
| ------ | -------------------------------- | ------ |
| TP-001 | 可移植包、ReAct 核心和示例       | 已完成 |
| TP-002 | Mint adapter 与兼容回归          | 已完成 |
| TP-003 | ReAct 集成验证与 Harness 证据    | 已完成 |
| TP-004 | 创建独立 Tool Runtime 包         | 已完成 |
| TP-005 | Mint Tool Runtime adapter 接入   | 已完成 |
| TP-006 | 工具安全回归、Harness 与证据回写 | 已完成 |

### TP-001：创建可移植框架包与 ReAct 核心

- 状态：已完成
- 关联：AC-001/002/003/005；DS-001/002/003
- 任务：workspace/package 构建；通用消息/模型/工具/事件契约；ReAct agent；Node README 示例；框架核心测试。
- Probe：package build/import/pack；框架单测和 process smoke。
- 产出文件：`packages/react-runtime/**`、必要 workspace 配置。
- 执行记录：框架 API、ReAct 核心、独立构建、包导入、测试、打包和示例已完成。

### TP-002：接入 Mint 适配层并保持运行语义

- 状态：已完成
- 关联：AC-004；DS-004
- 任务：将既有 Mint 模型轮次和工具执行委托给通用 ReAct 核心；维持 AgentRun、审批、SSE、上下文、Composer 和结果映射；保留 `runAgentChat` 签名。
- Probe：既有 ReAct、审批恢复、eval/subagent 定向测试与 server typecheck。
- 产出文件：`server/agent-runtime/**`、`server/bootstrap/agent-runtime.ts`、对应测试。
- 执行记录：Mint adapter 接入 `runAgentChat` 路径；ReAct、审批、消息服务和子 Agent 回归通过。

### TP-003：集成回归、Harness 验收和证据回写

- 状态：已完成
- 关联：AC-001~005；DS-005
- 任务：运行包级及 Mint 相关验证，修复本变更范围内失败，完成 Harness claim 聚合并写回证据。
- Probe：本变更 `verification-plan.json` 与 `harness-checks.json`。
- 产出文件：测试文件、`.harness/runs/` 证据、执行记录。
- 执行记录：Harness claims、ESLint、Prettier、`git diff --check` 和 SDD 追溯检查通过。

### TP-004：创建独立 Tool Runtime 包

- 状态：已完成
- 关联：AC-006/007/009；DS-006
- 任务：实现通用 ToolRegistry、校验/策略 gate、超时/取消和结构化结果；增加独立 Node 示例。
- Probe：Tool Runtime unit/integration、build、tarball install/import smoke。
- 产出文件：`packages/tool-runtime/**`、根 workspace 与依赖配置、package tests。
- 执行记录：registry/runtime、6 个包级用例、独立 tarball import smoke 和 pack 通过。

### TP-005：Mint Tool Runtime adapter 接入

- 状态：已完成
- 关联：AC-008；DS-007
- 任务：让 Mint ToolRegistry 包装通用 registry；让 Mint ToolExecutor 的生产路径调用通用 runtime；保留权限、审批、invocation ledger、safe retry、脱敏 audit、Mint ToolCall 输出。
- Probe：ToolExecutor security/handlers/retry、ToolExecutionService、approval、MCP/Wiki tool tests。
- 产出文件：`server/application/agent-runtime/tooling/`、相关 tests 和 `server/package.json`。
- 执行记录：Mint registry/executor 已接入通用 package；安全、审批、幂等、重试和审计定向回归通过。

### TP-006：工具运行时集成验证

- 状态：已完成
- 关联：AC-006~009；DS-006/007
- 任务：独立安装 smoke、工具拒绝/审批/取消/超时 side-effect gate、Harness claim verify 和 SDD 回写。
- Probe：`scripts/run-react-runtime-harness.mjs`（运行本变更完整 claim checks）。
- 产出文件：Harness evidence、执行记录和最终追溯状态。
- Harness run：`2026-10-08T08-46-46-365Z-97989`；11 个 checks 通过，AC-001 至 AC-009 claims 均为 PASS。
- 验证：两个 packages build/test/tarball smoke/pack、Mint ReAct 与工具回归、Server typecheck、ESLint、Prettier 和 `git diff --check` 通过。
- 结果：全部验收标准通过；保留工作区其他未提交改动。

## 验证命令

```bash
npm run build -w @mint/react-runtime
npm run build -w @mint/tool-runtime
node packages/tool-runtime/scripts/package-smoke.mjs
npm run test -w @mint/tool-runtime
npm pack --dry-run -w @mint/tool-runtime
node --input-type=module -e "import('@mint/react-runtime').then(m => { if (!m.createReactAgent) process.exit(1); })"
npm pack --dry-run -w @mint/react-runtime
npm test -w @mint/react-runtime
cd server && npx vitest run agent-runtime/__tests__/react-loop-core.test.ts application/agent-runtime/__tests__/tool-approval-service.test.ts application/conversations/__tests__/message-service.test.ts application/tools/agents/__tests__/invoke-agent-tool.test.ts --poolOptions.threads.singleThread
cd server && npx vitest run application/agent-runtime/__tests__/tool-execution-security.test.ts application/agent-runtime/__tests__/tool-execution-service.test.ts application/agent-runtime/__tests__/tool-retry-policy.test.ts application/agent-runtime/__tests__/tool-approval-service.test.ts application/agent-runtime/__tests__/tool-audit-log.test.ts application/agent-runtime/__tests__/tool-handlers.test.ts application/agent-runtime/__tests__/tool-catalog-service.test.ts infrastructure/mcp/__tests__/mcp-tool-adapter.test.ts application/tools/wiki/__tests__/wiki-ingest-tool.test.ts --poolOptions.threads.singleThread
npm run typecheck -w mint-server
npm run harness:inspect -- --change 2026-10-08-react-runtime-package
node scripts/run-react-runtime-harness.mjs --writeback
```

## 执行记录

### 初始化

- 状态：SDD 创建后进入执行；TP-001 从此处启动，当前三个 TP 均已完成。
- 验证：实现前 Harness inspect 和最终 claim verification 均通过。
- 风险：工作区包含与本变更无关的未提交文件；保持路径隔离。

### TP-001：框架包与 ReAct 核心

- 状态：已完成
- 产出：`packages/react-runtime/` workspace 包、通用模型/工具/事件合约、ReAct 核心、Node 示例和 package smoke。
- 验证：框架 Vitest 5/5；独立 TypeScript build、包名导入 smoke、声明文件检查和 `npm pack --dry-run` 通过。
- 观察：运行时 package 没有依赖项；打包清单只含 dist、README 和 package metadata。

### TP-002：Mint 适配层

- 状态：已完成
- 产出：`server/agent-runtime/mint-react-adapter.ts` 与 ReAct 主循环集成；`runAgentChat` 兼容入口保留。
- 验证：Mint ReAct、审批服务、工具执行、消息服务和子 Agent 定向回归通过；Server typecheck 通过。
- 观察：审批、AgentRun、Mint 事件、上下文、A2UI/Wiki 输出和工具执行仍由 Mint adapter/host ports 负责。

### TP-003：Harness 验证与收尾

- 状态：已完成
- Harness run：`2026-10-08T07-59-31-127Z-64380`；6 个 checks 通过，AC-001 至 AC-005 claim 均为 PASS。
- 验证：package build/test/import/pack，5 个 Mint 定向回归文件、Server typecheck、ESLint、Prettier 和 `git diff --check` 通过。
- 结果：所有验收标准满足，快捷索引已更新；未修改其他变更目录。

### 2026-10-08：Harness run 2026-10-08T07-56-01-030Z-59325

- 状态：failed
- TP：TP-003
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T07-56-01-030Z-59325
- 检查结果：runtime-unit:passed, runtime-package-smoke:failed, claims:FAIL

### 2026-10-08：Harness run 2026-10-08T07-56-37-461Z-60322

- 状态：completed
- TP：TP-003
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T07-56-37-461Z-60322
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, mint-adapter-regression:passed, server-typecheck:passed, claims:PASS

### 2026-10-08：Harness run 2026-10-08T07-59-31-127Z-64380

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T07-59-31-127Z-64380
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, mint-adapter-regression:passed, server-typecheck:passed, claims:PASS

### 2026-10-08：Harness run 2026-10-08T08-45-53-198Z-97000

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T08-45-53-198Z-97000
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, tool-runtime-package-build:passed, tool-runtime-unit:passed, tool-runtime-package-smoke:passed, tool-runtime-package-pack:passed, mint-adapter-regression:passed, mint-tool-runtime-regression:passed, server-typecheck:passed, claims:PASS

### 2026-10-08：Harness run 2026-10-08T08-46-46-365Z-97989

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T08-46-46-365Z-97989
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, tool-runtime-package-build:passed, tool-runtime-unit:passed, tool-runtime-package-smoke:passed, tool-runtime-package-pack:passed, mint-adapter-regression:passed, mint-tool-runtime-regression:passed, server-typecheck:passed, claims:PASS
