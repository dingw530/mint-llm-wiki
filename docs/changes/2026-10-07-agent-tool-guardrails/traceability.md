# 追溯总览：Agent 工具安全与重试边界加固

## 变更状态

| 字段     | 值                               |
| -------- | -------------------------------- |
| 变更标识 | 2026-10-07-agent-tool-guardrails |
| 状态     | 执行中                           |
| 创建日期 | 2026-10-07                       |
| 完成日期 | —                                |
| 当前阶段 | TP-005：最终 Harness（环境阻塞） |

## 需求追溯

| ID     | 需求                                         | 设计           | 执行任务 | 状态   |
| ------ | -------------------------------------------- | -------------- | -------- | ------ |
| US-001 | 有副作用工具遵守服务端审批                   | DS-001         | TP-001   | 已完成 |
| US-002 | 模型 Schema 与服务端校验一致                 | DS-002         | TP-002   | 已完成 |
| US-003 | 重试不重复执行副作用                         | DS-003/004/005 | TP-003   | 进行中 |
| US-004 | 有调用上下文且不泄漏敏感内容的结构化工具日志 | DS-006         | TP-004   | 待启动 |

## 功能与验收追溯

| AC     | 业务规则   | 设计       | TP         | Probe                                                             | 风险     | 最低证据              | 状态                                                 |
| ------ | ---------- | ---------- | ---------- | ----------------------------------------------------------------- | -------- | --------------------- | ---------------------------------------------------- |
| AC-001 | BR-001~003 | DS-001     | TP-001     | tool-execution-security                                           | high     | integration           | PASS；逐 AC Harness integration                      |
| AC-002 | BR-003     | DS-001/004 | TP-001/005 | tool-approval-write-guard-integration + tool-approval-write-guard | high     | browser + integration | BLOCKED；integration PASS，Chrome SIGABRT/kill EPERM |
| AC-003 | BR-004     | DS-002     | TP-002     | tool-schema-contract                                              | high     | unit                  | PASS；逐 AC Harness                                  |
| AC-004 | BR-005     | DS-002     | TP-002     | mcp-schema-validation                                             | high     | integration           | PASS；逐 AC Harness                                  |
| AC-005 | BR-006     | DS-002     | TP-002     | tool-schema-contract + tool-input-cross-field                     | high     | unit + integration    | PASS；逐 AC Harness                                  |
| AC-006 | BR-007/009 | DS-003     | TP-003     | tool-outcome-unknown-smoke                                        | critical | process-smoke         | PASS；跨进程恢复，副作用计数 1                       |
| AC-007 | BR-008     | DS-003/004 | TP-003     | tool-retry-policy                                                 | high     | integration           | PASS；逐 AC Harness                                  |
| AC-008 | BR-010     | DS-004     | TP-003     | tool-error-contract                                               | medium   | unit + integration    | PASS；逐 AC Harness                                  |
| AC-009 | BR-010     | DS-005     | TP-005     | agent-tool-regression                                             | high     | integration           | PASS；逐 AC Harness                                  |
| AC-010 | BR-011     | DS-006     | TP-004     | tool-audit-log-integration                                        | high     | integration           | PASS；逐 AC Harness                                  |
| AC-011 | BR-012/013 | DS-006     | TP-004     | tool-audit-redaction                                              | high     | integration           | PASS；逐 AC Harness                                  |

## 执行任务追溯

| TP     | 目标                               | 关联验收       | 状态                                             |
| ------ | ---------------------------------- | -------------- | ------------------------------------------------ |
| TP-001 | 审批元数据和服务端策略收敛         | AC-001/002     | 已完成                                           |
| TP-002 | 闭合 Schema 与 MCP 全量约束验证    | AC-003/004/005 | 已完成                                           |
| TP-003 | 调用身份、幂等状态和安全重试       | AC-006/007/008 | 已完成                                           |
| TP-004 | 接通结构化工具调用日志并验证脱敏   | AC-010/011     | 已完成                                           |
| TP-005 | 全链路回归、Harness 验证与证据回写 | AC-001~011     | 进行中；AC-002 browser 与全量 Harness 受环境阻塞 |

## 偏差表

| 日期 | 类型 | TP  | 文件/主题 | 原因           | 影响 | 后续动作 |
| ---- | ---- | --- | --------- | -------------- | ---- | -------- |
| —    | —    | —   | —         | 当前无实现偏差 | —    | —        |

## 执行记录

### 初始化与 TP-001/TP-002 执行

- 状态：执行中；TP-001/TP-002 已完成，TP-003 进行中，TP-004/TP-005 待启动。
- 产出：本变更目录中的 SDD 与 Harness 计划文件。
- 验证：Harness 自身测试 18/18 通过；Node 20.19.4 与 better-sqlite3 预检通过；Harness inspect 通过。
- 执行前既有未提交路径已记录在 exec-plan，未修改其他变更文档。

### TP-001：审批元数据和服务端策略收敛

- 状态：已完成
- 产出文件：Tool contracts/BaseTool、ToolPolicy、ToolExecutionService、Bash/HTTP/KnowledgeGraph/InvokeAgent metadata、MCP adapter/client manager，以及对应服务端测试。
- 验证：`tool-execution-security`、`tool-handlers`、`tool-execution-service`、`mcp-tool-adapter`、`mcp-client-manager`、`tool-approval-service` 共 6 个文件 92/92 通过；server typecheck、Prettier、`git diff --check` 通过。
- 证据边界：浏览器审批交互仍待最终 Harness browser-ac；当前 AC-001 局部 integration 覆盖审批前不调用工具，整条浏览器流未计为 PASS。
- 问题与处理：旧 Bash 测试把高风险删除命令当作允许，已更新契约和测试；知识图谱写入按 action 要求审批，查询仍免审批。

### TP-002：闭合 Schema 与 MCP 全量约束验证

- 状态：已完成
- 产出：`json-schema-policy.ts`、`mcp-input-schema.ts`、Ajv dependencies、MCP input validation 与 Wiki 跨字段 validation tests。
- 验证：组合定向回归 10 个文件 125/125 通过；server typecheck、Prettier 和 `git diff --check` 通过。
- 观察：内置 Zod Schema 保留 required/default/enum/range/array/object 约束；非法或不支持 MCP Schema 工具被禁用，远端调用数为 0；Wiki 的 question/paths 与摄入来源组合错误在副作用前拒绝。
- 风险/偏差：`BaseTool.getDefinition` 影响等级为 CRITICAL/lower-bound，按窄边界完成；MCP readOnlyHint 不作为授权依据，所有 MCP 调用等待审批。

### TP-003：调用身份、幂等状态和安全重试

- 状态：已完成
- 产出：migration 33、ToolInvocationRepository、ToolExecutionService invocation 身份注入、ToolExecutor retry/error contract、Wiki 幂等键注入、repository/retry tests、进程 smoke。
- 验证：`tool-retry-policy`、`tool-outcome-unknown-smoke` probes 通过；进程中断恢复后 `outcome_unknown` 且不重放，side effect count 保持 1。
- 风险/偏差：远端副作用无法和 SQLite 原子提交；不承诺 exactly-once。

### TP-004：结构化工具日志与脱敏

- 状态：已完成
- 产出：`StructuredToolAuditSink`、ToolExecutionService 默认 sink 注入、输入形状摘要和审计集成测试。
- 验证：`tool-audit-log-integration`、`tool-audit-redaction` probes 通过；日志字段按白名单构建，敏感 canary 未出现在捕获事件中。

### TP-005：Harness 验收

- 状态：进行中，等待运行环境允许本地监听和 Chrome 启动/清理。
- Claim run：`2026-10-08T03-50-10-658Z-93574`；AC-001、AC-003 至 AC-011 PASS；AC-002 的 integration PASS，临时 cache 路径下 Chrome 仍 `SIGABRT` 退出，清理进程 `kill EPERM`。
- 完整 Harness run：`2026-10-08T03-46-05-065Z-88436`；unit 为 1161/1165，4 个需要监听 `127.0.0.1` 的测试因 `listen EPERM` 失败，检查因此停止。
- 其他验证：定向回归 13 文件 129/129；Harness 自测 18/18；server typecheck、process-smoke、Prettier、`git diff --check` 通过。
- 环境复核：`lsof` 显示工作区 Vite 进程监听 `[::1]:5800`，受限 shell 仍连接失败；Chrome 启动触发 `SIGABRT`/`kill EPERM`，桌面浏览器桥接超时且内置浏览器不可用，未获得 browser evidence。
- 交接：在允许本地监听和 Chrome 启动/清理的环境运行 `node scripts/run-tool-guardrails-harness.mjs` 及完整 Harness；完成浏览器 evidence 后再关闭变更。

## 交接

- 当前进度：TP-001 至 TP-004 已完成；AC-001、AC-003 至 AC-011 有 claim-level PASS。
- 下一步：等待环境允许本地监听及 Chrome 启动/清理后，完成 AC-002 browser 和完整 Harness 验收。
- 已知阻塞：当前环境的 local socket bind 返回 `listen EPERM`，Chrome 启动后 `SIGABRT` 且清理被 `kill EPERM` 拒绝；AC-002 尚无 browser evidence，因此不能标记变更完成或归档。
