# 设计文档：Agent 工具安全与重试边界加固

## 背景与目标

当前工具链已统一经过 ToolExecutor，但授权分类、Schema 严格度与重试安全规则仍散落在工具声明、MCP 适配和运行时调用层。设计目标是建立三条明确边界：**服务端策略决定能否执行；发布给模型的 Schema 与服务端校验一致；重试只能发生在结果确定且副作用可安全重放时。**

本变更校准历史工具安全 SDD 的审批保证，并覆盖当前代码审查发现的实现偏差。

## 约束

- 保留现有 ToolExecutor 单一执行入口、工具名、审批 UI、AgentRun 事件和 HTTP/Electron 共用协议。
- 不把权限交给 Prompt，也不把模型提交的 `tenant_id`、`riskLevel`、`approval` 或幂等策略当可信输入。
- 迁移必须使用 SQLite migration；旧 AgentRun 和旧 MCP Schema 数据可读。
- 远程副作用不能由本地状态表保证 exactly-once；超时后的不确定结果必须停止自动重试。
- 不要求数据库租户隔离；Mint 当前是单用户本地产品。

## 方案对比与决策

### 审批策略

- **方案 A：修正各工具 description。** 改动小，但模型描述仍是软约束，不能阻止直接调用。
- **方案 B：由 ToolMetadata 声明副作用和审批模式，ToolPolicy 强制判定（采用）。** 描述仅用于解释；缺失的风险声明按未知副作用处理。现有一次性审批存储和 UI 继续消费策略结果。
- **方案 C：全部工具都要求用户审批。** 安全但会破坏内置只读检索和日常体验，且不能替代细粒度策略；本方案只对远程 MCP 使用 fail-closed 默认。

### Schema 校验

- **方案 A：继续扩展手写 MCP 递归校验器。** 依赖少，但容易继续漏掉 JSON Schema 规则。
- **方案 B：采用直接声明的 JSON Schema 验证器，并限制支持方言、关键字、深度和字节大小（采用）。** Mint 自有 Zod Schema 仍生成模型定义；所有定义通过统一规范检查，执行侧使用对应校验器。选择具体依赖版本时以仓库依赖和 MCP Schema 方言审查为准。

### 幂等与重试

- **方案 A：把 `isIdempotent()` 当作全局重试许可。** 不能表达“有幂等键才可重试”、不同错误类别或调用结果未知。
- **方案 B：显式 `retrySafety` + 稳定调用身份 + 持久调用状态（采用）。** 可重试策略与真实副作用匹配；运行时在开始副作用前持久化调用状态，恢复时识别 `outcome_unknown`，不自动重放。
- **方案 C：为 MCP 提供 exactly-once 语义。** 远端是否支持幂等键不可控，本地无法证明，故不采用。

## 详细设计

### DS-001：服务端工具风险与审批元数据

扩展可信工具元数据，最少表达 `sideEffect`、`riskLevel`、`approvalMode` 和 `retrySafety`。推荐使用封闭枚举：

```ts
type ApprovalMode = 'none' | 'conditional' | 'always';
type RetrySafety = 'safe' | 'idempotency_key' | 'never';
```

每个内置工具显式声明策略，不再依赖 BaseTool 的泛化默认值推导授权。`write_file` 与 `wiki_ingest` 设为 `always`；HTTP 方法和 Bash 命令可由后端对已解析参数做 `conditional` 判定；所有 MCP 工具设为 `always`。远端 `readOnlyHint` 和 description 都只是提示，不是本地授权。

ToolExecutor 顺序固定为：

```text
解析 → 查找工具 → Schema 校验 → 工具级权限 → 后端风险策略
→ [审批并等待批准] → 持久化 invocation=executing → 执行
→ 结构化结果 → AgentRun/SSE/UI
```

若 `validateInput=false` 或 `checkPermission=false` 仅用于内部测试，应从生产入口移除绕过能力，或限制为明确的 test-only 构造路径。拒绝/审批事件要在真正调用工具前产生。Bash 的高风险拦截应走统一审批结果，不再以 `success: true` 包装一个“未执行”的返回值。

### DS-002：封闭且有界的工具 Schema

- Mint 自有 Zod object 的 JSON Schema 递归设置 `additionalProperties: false`；`z.record` 等动态 map 保留受约束的 schema-valued `additionalProperties`，不接受 `true`；不能安全表示的 Schema 在工具发布时失败。
- 约定 Schema 深度：根 object 为第 1 层；任一 object/array 子结构超过第 3 层时拒绝注册。
- 固定集合必须由 Zod enum 或等价 JSON Schema enum 表达。
- 内置运行时执行既有 Zod `safeParse` 和工具跨字段校验；Schema 转换不得丢失 `required`、类型、数值、长度、数组项或额外属性限制。
- MCP Adapter 使用直接依赖的 Ajv 2020-12 与 `ajv-formats`，校验完整的受支持子集。默认禁止外部 `$ref` 和网络解析器；限制 Schema 为 64 KiB、最多 512 个 schema 节点、最多三层 object、正则长度不超过 256 并拒绝常见嵌套量词风险；缺少 `additionalProperties` 时关闭额外属性，显式 `true` 失败关闭，schema-valued 动态 map 按其值 Schema 验证。
- Schema 错误统一返回 `errorCode=INVALID_TOOL_INPUT`，不调用远端 MCP Server。

### DS-003：稳定调用身份与有界重试

- ToolCall 执行上下文增加可信 `runId`、`callId` 和服务端生成的 `invocationId`；调用身份由运行时构造，不接受模型自行填写。
- 新增持久调用状态仓储，唯一键为 `(runId, callId)`，字段至少包含工具名、输入 hash、`status`、attempt、时间戳、错误类别和结果状态。不要在该表复制 API Key、Cookie 或完整工具输入。
- 状态约定：`prepared → executing → succeeded | failed | outcome_unknown`。重复 `succeeded` 返回已完成/既有结果引用；重复 `executing` 或 `outcome_unknown` 阻止自动执行并提示用户核验。
- `wiki_ingest` 在未提供幂等键时，由 invocationId 派生稳定幂等键传给任务服务；重复接收返回同一任务。
- `write_file` 重放必须由 invocation ledger 拦截；不同 callId 的新写请求仍按用户意图走审批，并遵循文件路径策略。
- MCP 的 `retrySafety=never` 是未知/副作用工具默认值。只有远端工具显式声明可安全重试，或支持并消费稳定幂等键，才可重试。
- 重试仅对结构化 `retryable=true` 的瞬时故障生效。参数错误、权限拒绝、审批拒绝、未知工具和副作用结果未知不重试。
- ToolRoundEngine 使用 `ExecutionResult` 的状态与错误分类判断重试，不能把 `{ error }` 当作 Promise 成功后误报执行成功，也不能对全部工具无差别套用 `toolMaxRetries`。

### DS-004：错误兼容与事件

错误对象增加稳定 `errorCode`、`retryable` 和安全 `message`；保留现有 `error` 字符串字段用于兼容。至少覆盖 `INVALID_TOOL_INPUT`、`PERMISSION_DENIED`、`APPROVAL_REQUIRED`、`TIMEOUT`、`TOOL_FAILED`、`OUTCOME_UNKNOWN`。事件只暴露用户/模型需要的安全摘要，不包含堆栈和凭证。

### DS-005：兼容策略与发布

- 保留当前工具名、MCP 加载方式、审批 endpoint 和 UI 按钮。
- migration 只新增调用状态记录，不重写历史聊天、工具描述或 Wiki 数据。
- 当前所有 MCP 工具均要求审批；远端 `readOnlyHint` 不降低风险，也不作为授权依据。
- 若恢复旧 AgentRun 时发现开始执行但无终态，标记 `outcome_unknown`；不重放该工具调用。

### DS-006：接通脱敏的结构化调用日志

ToolExecutor 已定义 `ToolAuditEvent`，但 `ToolExecutionService` 主路径没有注入 `ToolContext.audit`；因此仅有类型和局部 logger，不能证明每次调用都形成统一审计记录。本设计将生产执行路径接到一个必需的 `ToolAuditSink`，并让 `ToolRoundEngine` 的重试编排与执行层共享 invocation 级审计上下文：

- 首次 attempt 前记录开始事件；每个 attempt 的状态进入 invocation collector；重试编排结束后只产生一个最终摘要记录，确保 `retryCount` 是总值且 `durationMs` 覆盖整个逻辑调用。
- ToolExecutionService/ToolExecutor 主路径必须注入 sink；若日志 sink 故障，不得改变工具授权结果或导致敏感参数被回退写入普通日志。
- 终态至少含 `timestamp`、`invocationId`、`runId`、`callId`、`toolName`、`source`、`riskLevel`、`durationMs`、`resultCode`、`errorCode`、`retryCount`、审批状态和安全参数摘要。
- `resultCode` 使用固定 enum：`success`、`invalid_input`、`permission_denied`、`approval_required`、`failed`、`timed_out`、`cancelled`、`outcome_unknown`。
- 新增 `getAuditSummary()` 契约，与展示用 `getCallSummary()` 分离。默认摘要仅含字段名/类型、数组项数、字符串/二进制长度；具体值只有经过代码审查并列入工具级允许列表后才能记录。
- MCP 通用摘要不记录远端任意字段值；仅记录 schema 字段名、值类型与集合计数。不得把 MCP description、参数原文或结果预览复制到审计日志。
- 递归脱敏匹配 `authorization`、`cookie`、`apiKey`、`token`、`password`、`secret`、`credential` 等敏感键；URL 日志摘要移除 userinfo、query 和 fragment。正文、Wiki 搜索 query、文件路径/内容、HTTP 请求体和堆栈默认不记录。
- 结构化 logger 输出固定事件名和固定字段；错误只记录稳定 `errorCode` 和安全类别，不把原始异常消息直接作为参数字段。
- 脱敏测试使用嵌套对象、数组、URL、请求头和正文 canary；断言序列化日志中不包含 canary。测试还要确认主执行路径始终调用 sink。

本次只提供可检索的结构化应用日志，不引入 p99 指标、告警、集中式日志服务或新的 UI。

## 影响与风险

- 影响范围：Tool contracts、BaseTool/Schema 转换、MCP Adapter、ToolPolicy/Executor、ToolRoundEngine/ReAct、AgentRun persistence/recovery、SQLite migration/repository、结构化日志 sink、内置工具定义与测试。
- 兼容风险：严格 Schema 会拒绝过去被忽略的多余字段；运行前需对所有注册工具做自动盘点。
- 兼容风险：所有 MCP 工具审批会增加交互，但保持远端元数据不能自行授权的边界；后续如需本地只读白名单，必须另行定义权限配置与验证。
- 恢复风险：调用状态与外部副作用不能原子提交；未知状态禁止重放而非声称 exactly-once。
- 结果风险：无需保存大体积工具原始结果到调用状态表；重启后如果没有可用结果，只能标记未知并要求用户核验。
- 隐私风险：工具调用摘要不是天然安全；禁止复用 UI 展示摘要或通用 `JSON.stringify(input)`，所有日志字段按白名单构造。

## 发布验证

- 先运行工具目录 Schema 静态审计，报告工具名、Schema 深度、开放对象、无 enum 集合和风险元数据缺失项。
- 服务端 integration 测试使用临时 Wiki/SQLite 和可计数假工具，观察审批前调用次数为 0、批准后为 1、重复消费仍为 1。
- 通过进程/恢复探针验证 `executing` 期间中断会变为 `outcome_unknown` 且不重放。
- 使用 MCP 假 Server 返回深层、未知关键字、类型错误和额外属性输入，观察工具调用计数保持 0。
- Chat 浏览器场景验证用户批准/拒绝状态与现有审批卡片协议；UI mock 仅作为浏览器交互证据，不代替后端副作用次数证据。
- 日志 integration 测试通过注入结构化 logger 捕获实际 ToolExecutionService 主路径，断言必填字段存在、未知值不落日志，并扫描嵌套敏感 canary。

## 验收证据矩阵

| AC     | 设计       | 主要观察值                                                     | 最低证据              |
| ------ | ---------- | -------------------------------------------------------------- | --------------------- |
| AC-001 | DS-001     | 各风险工具 approval 前后 execute count；拒绝/过期/重放调用次数 | integration           |
| AC-002 | DS-001/004 | HTTP/Electron 事件状态与 UI 操作结果                           | browser + integration |
| AC-003 | DS-002     | 全内置工具 Schema inventory 断言、最大深度和闭合规则           | unit                  |
| AC-004 | DS-002     | MCP validator 正反例和 remote call count=0                     | integration           |
| AC-005 | DS-002     | 无效跨字段输入不触发 Wiki 搜索或摄入任务                       | unit + integration    |
| AC-006 | DS-003     | 重复调用/进程中断前后副作用计数、持久 status                   | process-smoke         |
| AC-007 | DS-003/004 | retry attempts、retryable classification、非幂等调用次数       | integration           |
| AC-008 | DS-004     | errorCode/retryable/no-stack 与旧 error 消费兼容               | unit + integration    |
| AC-009 | DS-005     | Wiki、MCP discovery、AgentRun recovery 回归结果                | integration           |
| AC-010 | DS-006     | 主路径捕获的字段集合、调用次数和终态 resultCode                | integration           |
| AC-011 | DS-006     | nested canary 扫描、URL/body/stack 脱敏断言                    | integration           |
