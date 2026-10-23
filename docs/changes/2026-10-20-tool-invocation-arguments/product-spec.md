# 工具调用参数对账记录

## 背景与目标

工具中断后，Ledger 只有 inputHash，无法还原目标文件或预期内容。保存完整参数，供人工或后续受控的只读查询核对实际结果。

## 用户故事与范围

- US-001：作为维护者，我需要按 runId + callId 读取原始调用参数，以核对未知结果。
- US-002：作为当前会话的 Agent，我需要用 get_tool_invocation 查询指定调用的记录，并按需读取参数，为只读对账提供依据。
- US-003：作为恢复后的 Agent，我需要自动看到中断工具调用的原始参数和未知结果提示，不依赖用户或模型猜测调用 ID。
- FP-001：通过 ToolExecutionService 获准进入执行阶段的调用，在工具执行前保存完整参数。
- FP-002：服务端显式读取参数；普通 Ledger 元数据和审计事件不返回明文。
- FP-003：将 get_tool_invocation 注册为模型可见的只读内置工具。
- FP-004：恢复运行时，从原运行事件和 Ledger 重建 assistant tool-call 与合成 tool-result 消息，并加入 successor run 的模型上下文。
- 非目标：本次不增加 UI、公开 API、自动对账、LLM 恢复策略、参数自动重放或工具结果存储。

## 业务规则

- BR-001：保存模型 Tool Call 的原始 arguments JSON 字符串，包含正文，不截断、不脱敏后替代原文；工具内部派生的值不属于原始参数。
- BR-002：参数使用现有 AI_CHAT_ENCRYPTION_KEY 加密，与 executing 占位记录同事务提交后才允许工具执行。持久化失败时拒绝执行。
- BR-003：已有调用的参数快照不可被重试或身份冲突覆盖；旧记录保持缺失，不推测历史参数。
- BR-004：outcome_unknown 不自动重放；参数仅证明调用意图，不证明外部动作完成。
- BR-005：查询必须有当前 conversationId，且目标运行的持久化 run_started 事件属于该会话。跨会话、缺少归属、归属读取失败均拒绝；在权限检查和执行入口均检查。
- BR-006：默认仅返回元数据。include_arguments 显式为 true 时返回完整原始参数，并区分 available、missing、unavailable。未请求参数时返回 not_requested，不执行解密。
- BR-007：查询不修改目标调用状态，不返回未存储的完整 Tool Result；结果明确标注外部状态未经核实。
- BR-008：仅为 `tool_outcome_unknown` 重建历史；保留原 callId、工具名和可解密的完整参数，结果指出 originalRunId、Ledger 状态和外部状态未核实。
- BR-009：历史参数缺失、损坏或解密失败时，合成参数 `{}` 只是格式占位，结果必须明确标注未恢复参数并禁止直接执行或重试；恢复列表隐藏 Retry，服务端拒绝直接 Retry 请求。
- BR-010：合成 tool-result 不修改原 Ledger、AgentRun 状态或外部状态；原调用不会自动重放。
- BR-011：若未完成的 AgentRun 调用在 Ledger 中已是 succeeded，恢复列表不得提供 retry；服务端必须拒绝直接 retry 请求，并只允许进入对账继续或放弃。
- NF-001：不向普通元数据、审计事件或 Agent 生命周期日志新增明文参数。密钥和数据库备份需一起保留。

## 验收标准

| AC     | 声明                                                                                | 风险   | 不变量                                                                                        | 最低证据             | TP / probe                                           |
| ------ | ----------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------- |
| AC-001 | 完整参数与调用身份原子保存，执行前已提交；失败不执行                                | high   | snapshot_before_execute, atomic_claim, fail_closed                                            | integration          | TP-001 / invocation-arguments-integration            |
| AC-002 | 显式读取返回原文，数据库和普通元数据不新增明文                                      | high   | exact_round_trip, encrypted_at_rest, explicit_read                                            | integration          | TP-001 / invocation-arguments-integration            |
| AC-003 | 重试及冲突不覆盖快照，旧记录无参数仍兼容                                            | medium | immutable_snapshot, legacy_missing                                                            | integration          | TP-001 / invocation-arguments-integration            |
| AC-004 | 重启后未知调用参数仍可读取，且仍拒绝重放                                            | high   | unknown_no_replay, durable_snapshot                                                           | integration          | TP-001 / invocation-arguments-integration            |
| AC-005 | 工具已注册且模型可见，只允许当前会话所属运行；归属缺失或读取失败拒绝                | high   | registered_visible, conversation_scope, fail_closed                                           | integration          | TP-002 / invocation-query-integration                |
| AC-006 | 默认不解密，显式请求返回完整原文或明确标注缺失/不可读                               | high   | explicit_read, no_default_decrypt, exact_round_trip                                           | integration          | TP-002 / invocation-query-integration                |
| AC-007 | 查询只返回 Ledger 事实，不修改未知状态、不执行重放、不伪造完整结果                  | high   | read_only, unknown_no_replay, external_state_unverified                                       | integration          | TP-002 / invocation-query-integration                |
| AC-008 | successor 上下文自动包含原 callId、工具名、完整参数及未知结果；不要求模型提供 ID    | high   | restored_identity, exact_arguments, synthetic_unknown_result, no_auto_replay                  | integration          | TP-003 / recovery-transcript-integration             |
| AC-009 | 历史参数不可读时标注占位参数并拒绝 Retry；恢复合成本身不修改原运行                  | high   | placeholder_marked, no_replay_without_arguments, no_retry_without_arguments, origin_immutable | integration          | TP-003 / recovery-transcript-integration             |
| AC-010 | Ledger 已记录 succeeded 时，恢复卡片隐藏 retry；继续核对可用，直接 retry API 会拒绝 | high   | no_retry_after_success, continue_to_verify, server_retry_guard                                | integration, browser | TP-003 / recovery-transcript-integration, browser-ac |

## 风险与依赖

依赖已有 SQLite Ledger 和 AES-256-GCM 实现。完整内容增加数据库体积；本次沿用 Ledger 保留周期，不增加清理策略。密钥丢失、错误或密文损坏时读取失败，不降级为明文。历史记录无法补齐。本次不声称实现远端 exactly-once。

## 追溯

US-001 → FP-001/002 → BR-001…004、NF-001 → AC-001…004 → DS-001…003 → TP-001。

当前：Harness 证据确认 AC-001…010 全部通过。Docker smoke 因本机 daemon 未运行而待补验，详见 traceability.md。

扩展追溯：US-002、FP-003、BR-005…007 → AC-005…007 → DS-004 → TP-002。include_arguments=true 会把完整参数提供给当前模型，可能包含敏感正文；本次不承诺自动识别正文中的所有秘密。
