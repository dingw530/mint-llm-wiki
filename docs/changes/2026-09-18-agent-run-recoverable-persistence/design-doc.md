# AgentRun 可恢复持久化与可替换存储设计

## 目标与约束

本设计将现有“SQLite 事件日志 + 中断诊断”扩展为用户可操作的恢复能力，同时把持久化介质隔离在一个小型端口之后。本期只实现 SQLite adapter；JSONL 是未来同一端口的独立实现，禁止双写。

约束如下：

- 保持现有 `AgentRun.publish()` 的“持久化成功后才通知实时订阅者”语义，以及同步调用边界；本期不把 SSE 事件协议改成异步持久化协议。
- 领域层只依赖 `AgentRunPersistence`、恢复策略和纯 Reducer；不得导入 `better-sqlite3`、SQL 或 JSONL 文件 API。
- 事件历史是中断事实源；恢复索引仅为查询/幂等投影，不得覆盖或改写历史事件。
- 所有 schema 通过 migration 演进；HTTP 与 Electron 入口均通过 `endpoints/` 声明式注册。
- 未确认的副作用工具永不自动重放；恢复读取不得调用模型或工具。
- 本期不更改正常聊天 SSE payload、`ReactEventEmitter` 的兼容行为或既有进程内审批语义。

## 方案选项与取舍

### 方案 A：直接扩大 SQLite repository

继续在 `AgentRunEventRepository` 中增加所有恢复动作、SQL 和 SQLite 类型。

优点是初期改动少；缺点是 AgentRun 领域逻辑会永久绑定 SQLite，JSONL 后续必须复制上层行为或引入第二套恢复规则。放弃。

### 方案 B：SQLite 与 JSONL 双写

本期在 SQLite 事件表之外同步写 JSONL，以便未来切换。

缺点是崩溃时可能出现两份日志不一致、恢复来源不明确、加密/脱敏规则重复、迁移成本翻倍。放弃。

### 方案 C：同步持久化端口 + SQLite 唯一 adapter

定义介质无关的同步持久化端口，保留现有 durable-before-notify 语义。本期将 SQLite 作为唯一 composition-root 选择的 adapter；未来 JSONL 必须独立实现相同契约后才可作为替换项。采用。

## 最终设计

### DS-001：持久化端口与 backend 选择

新增领域端口（名称可在实现中微调，责任不变）：

```ts
interface AgentRunPersistence {
  appendEvent(input: AgentRunEventInput): AgentRunEventRecord;
  readEvents(runId: string): AgentRunEventRecord[];
  listOpenRunIds(): string[];
  getRecoveryAction(key: RecoveryActionKey): RecoveryActionResult | undefined;
  reserveRecoveryAction(input: RecoveryActionInput): RecoveryActionReservation;
  completeRecoveryAction(
    reservation: RecoveryActionReservation,
    result: RecoveryActionResult,
  ): RecoveryActionResult;
  failRecoveryAction(reservation: RecoveryActionReservation, failure: RecoveryActionFailure): never;
}
```

端口的同步返回是有意约束：当前 `AgentRun.publish()` 依赖同步 durable commit 才能在同一次调用中拒绝外部通知。未来 JSONL adapter 若不能在该契约内完成耐久追加，不得接入为 production backend；应先提出独立设计，不能静默降级为 write-behind。

composition root 在启动时创建唯一 adapter：

```text
AgentRun / RecoveryService
        ↓
AgentRunPersistence
        ↓
SqliteAgentRunPersistence  ← 本期唯一实现
```

`AgentRunEventWriter` 作为兼容窄接口可由该 adapter 提供，避免修改全部现有 `AgentRun` 调用方。backend 名称、版本和选择配置仅留在 composition root；运行中不可切换。

### DS-002：SQLite 数据模型

保留 `agent_run_events` 作为追加历史。新增 migration 创建下列投影/动作表；具体列名可按项目命名规范调整：

```text
agent_run_recovery_index
  run_id PK
  conversation_id
  last_event_sequence
  recovery_status: clean | interrupted | resolved_continued | resolved_retried | resolved_abandoned | corrupt
  unknown_tool_count
  safe_checkpoint_sequence
  updated_at

agent_run_recovery_actions
  action_id PK
  origin_run_id
  conversation_id
  action: continue | retry | abandon
  idempotency_key
  status: pending | completed | failed
  successor_run_id NULL
  result_json NULL
  failure_code NULL
  created_at
  completed_at NULL
  UNIQUE(origin_run_id, action, idempotency_key)
```

事件追加与恢复索引更新必须处于同一 SQLite transaction。索引可由完整事件日志重新生成，不能存储脱离事件的工具成功/失败结论。恢复动作 reservation、后继运行创建和已完成结果必须在同一 transaction 中保证唯一性。

`abandon` 不向原运行伪造历史 `run_cancelled` 事件：原运行仍是已中断事实，索引记录其已被用户放弃。`continue` 和 `retry` 都创建新的 `runId`，并通过 `origin_run_id` / `successor_run_id` 关联，不覆盖原日志。

### DS-003：恢复状态与工具策略

恢复服务先使用现有 Reducer 校验事件，再生成下列产品状态：

```text
clean                 已有真实终态，无恢复操作
interrupted           无真实终态，可能显示未知工具
resolved_continued    已创建安全后继 run
resolved_retried      已创建显式重试后继 run
resolved_abandoned    用户明确结束恢复处理
corrupt               读取失败；不可继续或重试
```

工具策略作为工具注册信息的恢复投影，而不是由事件名称推断：

```text
never                 不可自动/确认后重放；只能放弃或开始新的用户任务
requires_confirmation 不可自动重放；用户确认“创建新重试”后才可执行新的工具调用
safe_idempotent       仍不自动重放；本期同样要求显式用户重试，但可在 UI 中说明风险较低
```

恢复事件只持久化策略枚举、`callId`、工具名、脱敏摘要和可验证引用；工具原始参数、结果、密钥或 cookie 仍不入日志。后继 run 从已完成且已持久化的安全检查点构造上下文，引用已有持久化消息与配置版本；缺少所需引用时 fail closed 并仅允许放弃。

### DS-004：恢复动作状态机

```text
interrupted + 无未知工具
  ├─ continue → reserve action → 创建 successor run → resolved_continued
  ├─ retry    → reserve action → 创建 successor run → resolved_retried
  └─ abandon  → resolved_abandoned

interrupted + 有未知工具
  ├─ abandon  → resolved_abandoned
  └─ retry    → 展示工具策略与确认 → reserve action → 创建 successor run 或 fail closed

corrupt
  └─ abandon  → resolved_abandoned
```

`continue` 仅表示从安全检查点继续模型流程，绝不补发未知工具。`retry` 是用户显式创建的新运行，不是修改或重放旧运行。相同 `(originRunId, action, idempotencyKey)` 必须返回已保存的结果；同一来源运行已有完成的互斥恢复动作时，其他动作返回稳定冲突结果。

### DS-005：服务与 transport

新增 `AgentRunRecoveryService` 的领域命令和查询：

```text
listRecoverableRuns(conversationId)
getRecoverableRun(conversationId, runId)
resolveRecoveryAction(conversationId, runId, action, idempotencyKey, confirmation?)
```

通过 `server/endpoints/definitions/conversations.ts` 声明下列端点，并让 endpoint registry 自动生成 Express 和 Electron IPC 入口：

```text
GET  /conversations/:id/agent-runs/recoverable
POST /conversations/:id/agent-runs/:runId/recovery-actions
```

POST body 包含 `action`、`idempotencyKey`，以及只在 `retry` 且存在未知工具时使用的 `confirmation`。服务端负责重新读取状态与工具策略，客户端的按钮状态不得作为授权依据。

### DS-006：客户端恢复体验

客户端在加载会话消息后读取 recoverable runs，并在该会话消息流中渲染恢复卡片。卡片显示：中断状态、未知工具数量、可用动作、不可用原因和动作结果；不展示原始工具参数/结果或隐藏推理。

- `continue`、`retry`、`abandon` 在提交期间禁用，使用新生成的 idempotency key；请求重试复用该 key。
- 未知工具的 `retry` 先展示确认语句，说明它创建的是新运行，不能确认旧调用是否已执行。
- 成功创建后继 run 后，客户端订阅其现有 SSE 流；原卡片转为只读结果。
- API/IPC 冲突、损坏或无安全检查点时展示可诊断错误与放弃动作，不回退为普通“重新生成”。

### DS-007：故障与版本语义

- 事件 schema version 或 backend version 不支持、序列间断、payload 损坏、原运行与会话不匹配时，返回 `corrupt`/明确错误，不能创建后继 run。
- SQLite busy/写入错误不得返回成功按钮结果；reservation 未完成时可用同一 idempotency key 安全重试。
- JSONL backend 未来必须通过与 SQLite 相同的 adapter contract：连续事件、终态保护、事件和索引原子可见、动作幂等、损坏拒绝和最小数据原则。

## 影响与风险

- `streamChat` 与 `reactChat` 为高风险路径；后继 run 创建必须使用工厂/adapter 注入，不能改变现有实时协议字段。
- 当前运行时审批存于内存；本设计不把“重启后继续旧审批”作为承诺。恢复重试通过新的明确 action 处理，不能消费旧 approval ID。
- 事件索引、动作表和后继 run 关联增加 schema 与事务复杂度；migration、冲突与崩溃测试是发布前置条件。
- UI 恢复卡片影响聊天流程，必须有绑定 AC 的浏览器场景；全局页面健康检查不构成验收。

## 发布与验证

- 首发固定 SQLite adapter，配置中不暴露 JSONL fallback。
- 对已有用户数据库执行 migration；失败遵循现有 migration fail-closed 策略。
- 回滚只允许停用恢复 UI/endpoint，不得删除已写入的 AgentRun 历史或恢复动作；旧客户端可忽略新表。

## 验收证据矩阵

| AC     | DS             | 实现责任                                    | Probe / 最低证据                      |
| ------ | -------------- | ------------------------------------------- | ------------------------------------- |
| AC-001 | DS-002/003/006 | migration、recovery service、client card    | 重启恢复集成测试 + 绑定浏览器场景     |
| AC-002 | DS-003/004/006 | reducer、tool policy、client card           | 工具 mock 故障注入 + 浏览器场景       |
| AC-003 | DS-002/004/005 | action repository/service、endpoint、client | 并发/重复提交集成测试 + 浏览器场景    |
| AC-004 | DS-003/004     | ToolExecutor policy、recovery service       | 计数断言的副作用工具测试 + 浏览器场景 |
| AC-005 | DS-001         | port、SQLite adapter、composition root      | adapter contract + boundary/typecheck |
| AC-006 | DS-001/002/007 | migrations、AgentRun、SSE regression        | migration/回归测试 + Harness verify   |
| AC-007 | DS-001/007     | composition root/configuration              | 配置单元测试 + scope audit            |

## 偏差记录

| 日期       | 类型     | 内容                                                                                                                         | 影响                                                                                                       | 后续动作                                                                                                 |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 2026-09-18 | 实施阻塞 | 现有 durable event 未关联发起消息、Agent/模型配置版本或可重建的安全检查点；恢复 endpoint 也不是 SSE continuation transport。 | 无法安全实现 continue/retry；凭会话最后一条消息推断会错配运行，创建无订阅 successor run 则会形成悬挂运行。 | 产品需在“持久化最小恢复上下文并定义后继 SSE 协议”与“本期仅展示/放弃，继续和重试改为新对话操作”之间决策。 |
