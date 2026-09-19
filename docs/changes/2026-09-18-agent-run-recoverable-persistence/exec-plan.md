# AgentRun 可恢复持久化与可替换存储执行计划

## 完成定义

- [x] AgentRun 领域层通过持久化端口读写，不直接依赖 SQLite；SQLite 是唯一发布 backend。
- [x] 重启后的中断运行可在原会话中被发现，并安全地展示未知工具结果。
- [x] 用户可继续、重试或放弃；重复提交不产生多个后继 run 或重复副作用工具调用。
- [x] SQLite migration、HTTP/Electron endpoint、客户端恢复卡片和浏览器场景完成。
- [x] 所有 AC 具备匹配的自动化/浏览器证据；Harness、类型检查、构建和范围审计通过。

## 范围与前置条件

允许路径：

- `server/migrations/`、`server/repositories/`、`server/services/agentRun*.ts`、`server/services/api/`、`server/services/tools/` 及其直接测试；
- `server/endpoints/definitions/conversations.ts` 和由该声明生成/使用的 transport 测试；
- `client/src/features/chat/`、`client/src/services/api/` 及其直接测试和样式；
- `electron/` 中由声明式 endpoint 自动生成链路必须修改的最小文件；
- `docs/changes/2026-09-18-agent-run-recoverable-persistence/`、索引（仅归档阶段）；
- 本变更的 `browser-scenarios.json` 与 Harness 证据目录。

保护路径：`.claude/skills/`、`.harness/` 核心实现、无关的 Wiki/Memory/Vector/评测模块、现有用户未提交文件和 JSONL backend 实现。

前置条件：

```bash
node .gitnexus/run.cjs status
npm run harness:inspect -- --change 2026-09-18-agent-run-recoverable-persistence
cd server && npx vitest run services/__tests__/agentRun.test.ts services/__tests__/agentRunRecovery.test.ts --poolOptions.threads.singleThread
```

开始修改任一符号前，按 `AGENTS.md` 对目标符号执行 GitNexus upstream impact；若风险为 HIGH/CRITICAL，先记录影响并确认实时 SSE/审批兼容策略。

## 阶段任务

| TP     | 任务                                                | 状态   | 产出                                                     | AC                 |
| ------ | --------------------------------------------------- | ------ | -------------------------------------------------------- | ------------------ |
| TP-001 | 影响分析、持久化端口与事件/动作契约定稿             | 已完成 | impact 记录、类型/adapter contract、测试 fixture         | AC-005/006/007     |
| TP-002 | SQLite migration、事件投影和恢复动作幂等 repository | 已完成 | migration、SQLite adapter、repository 测试               | AC-001/003/006     |
| TP-003 | 恢复服务、工具策略和后继 run 创建                   | 已完成 | recovery service、ToolExecutor policy 接入、故障注入测试 | AC-002/003/004     |
| TP-004 | 声明式 HTTP/Electron endpoint 与客户端恢复卡片      | 已完成 | endpoint 定义、API client、UI、组件测试                  | AC-001/002/003/004 |
| TP-005 | 浏览器验收、回归、Harness 与证据回写                | 已完成 | browser scenarios、Harness run、traceability 执行记录    | AC-001~007         |

## 实施顺序与验证

### TP-001：契约与影响分析

- 对 `AgentRun.publish`、`streamChat`、`reactChat`、`resolveToolApproval` 和目标 endpoint 执行 impact 分析。
- 固化 `AgentRunPersistence` 的同步 durable contract，以及 recovery action 的枚举/冲突/幂等结果。
- 编写 adapter contract 测试，覆盖 SQLite 与未来 JSONL 必须满足的语义，但不创建 JSONL 实现。

Probe：

```bash
cd server && npx vitest run services/__tests__/agentRun.test.ts repositories/__tests__/agentRunEventRepository.test.ts --poolOptions.threads.singleThread
```

### TP-002：SQLite 存储

- 通过 migration 创建恢复索引和动作表；事件追加与索引更新同事务。
- 实现 SQLite adapter，保留原有事件读写/脱敏/序列保护。
- 验证 action reservation、完成、失败、相同 idempotency key、互斥动作和进程重启后的读取。

Probe：

```bash
cd server && npx vitest run repositories/__tests__/agentRunEventRepository.test.ts services/__tests__/agentRunRecovery.test.ts --poolOptions.threads.singleThread
```

### TP-003：恢复服务与安全策略

- 将开放 run 扫描接入恢复服务查询；损坏日志 fail closed。
- 从 ToolRegistry/ToolExecutor 的权威策略映射恢复等级；默认 `never`。
- 实现 continue/retry/abandon：创建后继 run 或稳定冲突，禁止隐式重放未知副作用工具。

Probe：

```bash
cd server && npx vitest run services/__tests__/agentRunRecovery.test.ts services/api/__tests__/toolApprovalService.test.ts services/__tests__/reactLoopCore.test.ts --poolOptions.threads.singleThread
```

### TP-004：用户路径

- 通过 `endpoints/` 声明恢复查询和动作 endpoint，验证 HTTP/IPC 一致性。
- 客户端在加载会话后显示恢复卡片；实现确认、loading、重复提交和错误状态。
- 新建 `browser-scenarios.json`，将每个场景绑定到 AC-001~004。

Probe：

```bash
cd client && npx vitest run src/features/chat --poolOptions.threads.singleThread
npm run harness:browser -- --change 2026-09-18-agent-run-recoverable-persistence
```

### TP-005：集成验证与交付

- 注入工具开始后进程中断、SQLite 写入冲突、重复 action、损坏事件和重启恢复。
- 启动开发服务后运行 Harness verify；逐 AC 回写实际 probe 和证据路径。
- 运行 `detect_changes()`，确认只影响预期执行流；更新 traceability 执行记录。

Probe：

```bash
npm run harness:test
npm run typecheck
npm run build
npm run harness:verify -- --change 2026-09-18-agent-run-recoverable-persistence
```

## 验收证据矩阵

| AC     | TP                 | Probe                                 | 证据状态 |
| ------ | ------------------ | ------------------------------------- | -------- |
| AC-001 | TP-002/004/005     | 重启恢复集成测试 + 浏览器场景         | 已验证   |
| AC-002 | TP-003/004/005     | 未知工具故障注入 + 浏览器场景         | 已验证   |
| AC-003 | TP-002/003/004/005 | 幂等/并发测试 + 浏览器场景            | 已验证   |
| AC-004 | TP-003/004/005     | 副作用工具计数测试 + 浏览器场景       | 已验证   |
| AC-005 | TP-001/002/005     | adapter contract + boundary/typecheck | 已验证   |
| AC-006 | TP-001/002/005     | migration/AgentRun/SSE 回归 + Harness | 已验证   |
| AC-007 | TP-001/005         | backend 配置测试 + scope audit        | 已验证   |

## 风险与停止条件

- 若同步 port 不能在不改变 `AgentRun.publish()` 兼容性的前提下支持未来 JSONL，停止实施并修订设计；不得先引入后台双写。
- 若恢复需要保存原始工具参数、密钥或完整 prompt，停止并扩展产品规格的隐私/加密决策。
- 若无法证明某工具幂等，按 `never` 处理；不得以测试缺失推断 `safe_idempotent`。
- 若 endpoint 或客户端范围需要突破允许路径，先更新 SDD 与 Harness allowed paths。
- 同一根因连续三轮无法通过验证，记录为 blocked 并停止自动扩大范围。

## 执行记录

| 日期       | TP     | 状态   | 产出/验证                                                                                                                                  | 问题                                            |
| ---------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 2026-09-18 | TP-001 | 已完成 | Harness inspect 已进入 claims 模式；GitNexus 图查询降级，改用源码链审查。                                                                  | 未修改实时 SSE/审批链。                         |
| 2026-09-18 | TP-004 | 已完成 | 增加 `chat:stream-recovery-action`，前端 action reserve 后经 IPC/SSE 立即启动 successor run；IPC handler test 7/7、typecheck、build 通过。 | 浏览器验收随后完成。 |
| 2026-09-19 | TP-005 | 已完成 | `harness:browser` 三个场景通过；`harness:verify` 通过，unit 840 passed。 | 浏览器日志保留已知 CSP meta 警告；Electron 真机未纳入本轮。 |
