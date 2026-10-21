# 工具调用参数持久化设计

## 背景、目标与约束

保存完整原始参数，支持按调用身份核对外部状态。保持最小 ReAct Core、Tool Runtime Port 和未知结果治理规则不变。参数记录位于 Mint 宿主持久化层。

## 方案与决策

明文写入通用审计日志容易扩散敏感正文。仅保存哈希无法定位目标。采用 Ledger 专用加密列和显式读取方法，复用现有加密设施。

### DS-001：迁移与原子记录

迁移 34 向 agent_tool_invocations 追加可空 arguments_encrypted TEXT。ToolInvocationInput 增加可选 argumentsJson，兼容直接调用仓库及旧记录。生产 ToolExecutionService 总是传入本次 Tool Call 的原始字符串。

ToolExecutor 完成 lookup、schema、permission、policy 与 approval 后，claim 回调进入 begin。首次插入时加密并在相同 SQLite immediate transaction 中写入参数与 executing 状态。begin 返回后才执行工具。密钥缺失、加密或数据库失败沿用 INVOCATION_STATE_UNAVAILABLE，工具不会执行。

### DS-002：显式读取与数据边界

ToolInvocationRepository.getArguments(runId, callId) 仅为可信服务端调用提供原始字符串。不存在或旧记录无快照时返回 undefined。解密失败抛出错误，不伪造可用参数。get() 继续只返回元数据。无新公开 API、SSE 或客户端数据字段。

对账示例：先用 get() 确认工具名、inputHash 与状态，再用 getArguments() 获取文件路径和预期正文。受控 read 工具或人工核对现状后，才决定新运行的操作；完整参数本身不构成执行授权。

### DS-003：不可变快照与恢复

参数仅在首次插入写入。已存在调用沿用身份/哈希冲突检查和重试策略，不改写原快照。升级前的空快照不补造。finish 与 markInterruptedUnknown 仅更新状态，不修改密文；恢复读取不会将未知状态改为成功，也不会触发重放。

### DS-004：get_tool_invocation 只读查询

输入 run_id、call_id、可选 include_arguments（默认 false）。工具继承 BaseTool，声明只读、幂等，沿用权限和策略入口；接入 bootstrap/tool-registry 与 ToolCatalogService 的 GLOBAL_TOOL_NAMES。

使用 AgentRunEventRepository.read 的第一条 run_started 事件核对运行身份、sequence=1 与当前会话。归属不可证明时拒绝；执行入口再次核对，防止直接调用 execute 绕过权限。只对已授权的运行读取 Ledger；调用不存在时明确失败。

输出 invocation 元数据、arguments 状态与可选 json，另标记 toolResultStored=false、externalStateVerified=false、reconciliationRequired。参数状态为 not_requested / available / missing / unavailable，解密异常不带底层异常详情返回。getResultSummary 只含工具名和状态。此工具不调用 finish、begin、恢复状态更新或原工具执行；正常 Tool Runtime 对查询自身的记账仍保留。

完整结果通过现有 Tool Round 的 artifact 流程处理大输出。include_arguments=true 可向当前模型暴露完整参数，仅在需要核对时请求；不增加公共 HTTP/Electron 端点。

调用示例：

```json
{
  "run_id": "original-run-id",
  "call_id": "original-call-id",
  "include_arguments": true
}
```

返回的 arguments.json 为原始 JSON 字符串。arguments.status=missing 表示调用没有快照，unavailable 表示读取或解密失败；均不能当作空参数。executing / outcome_unknown 的 reconciliationRequired=true，仍须核对实际状态后决定后续动作。

### DS-005：按持久化运行恢复未决 Tool Call

DeepSeek Harness 加载持久化 session 时，会从 assistant tool-call 和 tool/call 事件识别未决调用，并补一条同 callId 的合成 tool-result。Mint 在 `streamRecoveryAction` 服务端使用 origin run 的恢复状态识别未决调用，从 Ledger 解密读取原参数，再把 assistant `tool_calls` 与同 callId 的 role=tool 结果追加到 successor run 的模型上下文。

合成结果包含 originalRunId、originalCallId、Ledger 状态、`toolResultStored=false`、`externalStateVerified=false` 和核对指引。这样模型从上下文直接拿到两个 ID；需要更多 Ledger 信息时可调用 `get_tool_invocation`。重建只影响 successor 上下文，不伪造原工具结果、不改变原 Ledger 状态，也不重放原调用。

若历史参数缺失或解密失败，为保持 assistant/tool 消息配对，合成 tool-call 使用 `{}` 格式占位；合成结果标注 `argumentsRestored=false` 并明确禁止执行或重试该占位调用。恢复列表不提供 Retry，服务端也拒绝携带确认标记的直接 Retry 请求。

### DS-006：Ledger 成功状态优先于 AgentRun 尾事件

AgentRun 的 `tool_call_finished` 与工具 Ledger 分开写入；进程可能在 Ledger 记录 succeeded 后、AgentRun 完成事件持久化前退出。恢复列表因此读取每个未完成 callId 的 Ledger 状态。Ledger succeeded 时，卡片只提供继续核对和放弃；服务端收到绕过 UI 的 retry 也返回 409。继续操作的 synthetic tool-result 提醒不要重复执行原操作，并要求先用只读工具核对外部状态。

## 影响分析与风险

GitNexus：mint-ai-chat，索引对应 HEAD 87d35ec。ToolInvocationRepository LOW（直接调用方 tool-execution-service、bootstrap/agent-runtime）；ToolExecutionService LOW（tool-round-engine、bootstrap 等）。runMigrations 为 CRITICAL，335 个受影响符号、62 条流程；仅追加迁移，不改变迁移执行器或旧迁移。

TP-002 影响：ToolCatalogService LOW，直接依赖为 bootstrap/agent-runtime 和 composeAgentRuntimePorts。builtinTools / initializeToolRegistry 为 UNKNOWN；源码确认 initializeAgentRuntime 通过动态 import 调用 initializeToolRegistry，后者使用 builtinTools 注册。本次只新增工具实例与全局目录名，保留现有注册逻辑。新工具不改持久化仓库或迁移。

复用 AI_CHAT_ENCRYPTION_KEY；每次新增参数加密有同步密钥派生成本。无截断，存储随调用正文增长。记录为原始输入，不能替代工具内部派生参数或外部系统回执。

## 发布与验证

启动时通过迁移添加可空列；不对真实数据库提前执行迁移。浏览器场景不适用。运行 Harness inspect、服务端类型检查、Prettier 与 diff 检查。行为验收所需 integration probes 见 verification-plan.json；未获得动态证据前保持 AC 未验证，不归档。

## 验收证据矩阵

| AC     | 设计   | TP     | 预期观察                                                      |
| ------ | ------ | ------ | ------------------------------------------------------------- |
| AC-001 | DS-001 | TP-001 | 工具体读取时行已包含密文；写入失败时工具未调用                |
| AC-002 | DS-002 | TP-001 | 原文往返一致；原始 SQL 行及 get 元数据不含明文                |
| AC-003 | DS-003 | TP-001 | 重复调用不改写；旧行读取 undefined                            |
| AC-004 | DS-003 | TP-001 | 重启未知状态、完整原文和不可重放边界同时保留                  |
| AC-005 | DS-004 | TP-002 | 注册及目录包含新工具；跨会话、无归属、归属读取异常被拒绝      |
| AC-006 | DS-004 | TP-002 | 默认零解密；显式查询返回原文/缺失/不可读状态                  |
| AC-007 | DS-004 | TP-002 | 目标状态不变；输出不把 Ledger 当作外部完成证据                |
| AC-008 | DS-005 | TP-003 | successor transcript 自动配对原 callId、参数和未知结果        |
| AC-009 | DS-005 | TP-003 | 缺少快照时标注 placeholder，原 run / Ledger 状态不变          |
| AC-010 | DS-006 | TP-003 | succeeded 调用隐藏 retry；继续核对可用，直接 API retry 被拒绝 |

当前：Harness integration probes 和 browser scenario 验证 AC-001…010 全部通过。默认 Docker smoke 仍待本机 daemon 恢复后补验。
