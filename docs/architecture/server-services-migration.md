# Server services 目录迁移记录

## 范围

2026-10-05 按 Server 结构提案与用户扩展目标，将 `apps/server/services/` 下剩余的 TypeScript 实现迁入其 Agent Runtime、application、domain、infrastructure 或共享工具所有者。此次只调整内部模块归属与 import，不改变 HTTP、SSE、IPC、CLI、MCP 或数据库协议。

| 原职责                                                        | 新所有者                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `messageService`、`aiProxy`、context provider                 | `application/conversations/`                                                                  |
| AgentRun recovery adapter                                     | `application/agent-runtime/agent-run-recovery-service.ts`；事件 reducer 仍在 `agent-runtime/` |
| ReAct context window、RuntimeContext                          | `agent-runtime/`                                                                              |
| Tool contracts、catalog、execution、approval、round engine    | `agent-runtime/`、`application/agent-runtime/`、`bootstrap/`                                  |
| Wiki/Skills/Knowledge Graph/Agent/MCP tools                   | `application/tools/`                                                                          |
| Bash/HTTP/artifact、MCP transport adapter                     | `infrastructure/tools/`、`infrastructure/mcp/`                                                |
| 网络策略与 fetch                                              | `infrastructure/network/`                                                                     |
| Wiki/filesystem helpers、file parser、workspace/path policies | `infrastructure/filesystem/`；Wiki root settings facade 在 `application/wiki/wiki-path.ts`    |
| Encryption、Langfuse/logging、resilience                      | `infrastructure/security/`、`infrastructure/observability/`、`infrastructure/resilience/`     |
| Wiki citation formatting                                      | `infrastructure/transports/a2ui/`                                                             |
| Token estimation                                              | 纯工具 `apps/server/utils/token-estimator.ts`，Memory 与 Runtime 共用                              |
| Embedding compatibility facade                                | 删除；vector provider 的唯一实现位于 `infrastructure/search/vector/`                          |

`bootstrap/tool-registry.ts` 是内置 Tool handler 的唯一显式注册点。ToolCatalogService 接收 registry、MCP catalog、Agent lookup 和 MCP adapter factory；ToolExecutionService 经 ToolExecutor 处理每个模型调用。MCP invoker 由 bootstrap 注入，Wiki root 通过 application execution context 注入 Bash handler。

## 验证

- `apps/server/services/` 下没有 TypeScript 源文件；生产源码与边界测试中不再有指向旧 `services/` 实现模块的 import。
- `npm run verify:source`：typecheck、Server/Client/agent-eval 全量测试、engineering tests、lint 和 Server/eval/client build 全部通过。
- 定向 Tool、conversation、AgentRun recovery、上下文、Wiki/filesystem、网络、加密、resilience 与 observability suites 通过；迁移边界 suites 通过。
- `npm run build:mcp -w mint-server`、`npm run build:bundle -w mint-server` 与 `npm run cli --workspace mint-server -- --help` 通过。MCP CJS bundle 保留 esbuild 对既有 `import.meta` 用法的警告。
- `git diff --check` 通过。没有调用真实模型或连接外部 MCP Server；这些 checks 只证明本地构建和受控 tests。

## 迁移范围说明

工具策略、schema、调用 ID、MCP discover/load/legacy mode、Agent allowlist、审批 identity、timeout/cancel、审计和消息结果排序沿用原行为。按 impact 与全仓调用搜索确认后，移除了 `ToolRegistry.execute()`、`ToolRegistry.executeFromToolCall()` 和 `BaseTool.runFromToolCall()` 这三条无生产调用者的弱校验路径，避免绕过 ToolExecutor。
