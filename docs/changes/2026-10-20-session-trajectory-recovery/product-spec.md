# 会话轨迹持久化与恢复：产品规格

- 变更：`2026-10-20-session-trajectory-recovery`
- 日期：2026-10-20
- 级别：L2
- 状态：第一、二期原范围已验收；补充修订 TP-009 执行中，新增验收尚未验证。
- 范围来源：用户明确要求覆盖前两期；允许抽象 session 包；新增参考 DeepSeek 的完整轨迹面板；追加将组件纳入面向 Agent 的 React 组件库。
- 方案包名：`@mint/session` 与 `@mint/agent-ui`；后者为用户允许调整 `@mint/ui` 名称后的明确设计选择。

## 背景与目标

当前消息表主要保存用户消息和最终回答；AgentRun 日志只保存轮次、工具开始/结束和终态。工具参数已有独立加密快照。现有恢复入口只为未完成工具重建调用与合成结果，前端轨迹保存在内存中。因此，崩溃后不能重建该轮完整消息序列，也不能重开此前的完整轨迹。

目标是让用户强退后重新打开会话，仍能看到已提交的模型输出、工具调用、模型可见结果和中断节点，并直接发“可以继续吗”。系统在新轮开始前修复历史，由模型根据未知结果核对实际状态；副作用不会因读取或恢复轨迹而自动重放。

“完整轨迹”指已持久化的语义事件，不承诺每个流式 token、模型未返回的内部推理、外部系统完整原始数据或原进程调用栈。公开给当前适配器的 reasoning 字段在协议许可范围内保留；不生成缺失 reasoning。

## 用户、场景与用户故事

| ID     | 用户故事                                                           | 目标                            |
| ------ | ------------------------------------------------------------------ | ------------------------------- |
| US-001 | 作为对话用户，我要在崩溃后保留原调用和所有已完成结果，继续提出问题 | 新轮不遗忘此前已完成步骤        |
| US-002 | 作为排障用户，我要在独立轨迹视图检查输入、模型输出、工具参数和结果 | 可定位中断点与重复执行风险      |
| US-003 | 作为维护者，我要由同一语义日志派生上下文和轨迹                     | 避免界面有记录、模型却看不到    |
| US-004 | 作为 React 产品开发者，我要复用独立 Agent 轨迹组件                 | 不依赖 Mint API、路由或全局状态 |

## 范围与功能

### 第一期：语义日志与执行检查点

- FP-001：建立按会话排序、带版本的追加事件日志；记录模型消息、上下文变更、工具分派、模型可见结果及边界。
- FP-002：在执行副作用前提交分派凭据；在下一次模型请求前提交前序结果；存储失败时停止后续执行。
- FP-003：抽出 `@mint/session`，提供类型、校验、纯投影与冷恢复修复计划。
- FP-004：兼容旧消息和现有 Ledger，标注历史完整性，保留取消、审批与执行治理。
- FP-005：覆盖 ReAct 和普通 stream 工具路径，避免只改一个运行入口。

### 第二期：统一恢复与轨迹体验

- FP-006：普通发送、恢复按钮、重新生成、审批继续通过同一会话准备过程。
- FP-007：提供会话轨迹快照、增量和详情接口，同时注册 HTTP 与 Electron IPC。
- FP-008：创建 `packages/agent-ui`（`@mint/agent-ui`），首个公开组件为 `AgentTracePanel`。
- FP-009：在聊天标题下增加“对话 / 轨迹”页签；轨迹页参考用户提供的 DeepSeek 截图，显示三泳道总览、视图切换、搜索、事件列表和详情。
- FP-010：重开或刷新恢复已提交轨迹；同一会话新运行关联旧中断运行；切换页签保留输入草稿。
- FP-011：Session 事件日志成为聊天与轨迹的权威历史；消息表只作兼容投影，刷新后按 Session 重建聊天消息、推理和工具调用。
- FP-012：停止对 Session 事件载荷加密；新增迁移一次性解密旧事件并保存为 JSON，后续读取不再解密。凭据及独立工具 Ledger 的加密策略不变。

### 本轮不包含

逐 token 检查点、重做大工件存储/保留平台、多 Agent 递归子轨迹浏览、导出分享、分布式任务调度、远端 exactly-once 保证。不恢复进程调用栈，不从原工具中间字节处自动接续。子 Agent 作为当前会话的工具结果与已有关联 ID 记录，递归展开另行规划。

实现覆盖第一期语义日志与检查点，以及第二期统一恢复、轨迹 API 和 `@mint/agent-ui` 面板。行为证据和环境限制记录在 `traceability.md`；通过 Harness claims 不代表生产环境运行验证。

## 业务规则

- BR-001：会话是轨迹归属边界；runId 是执行边界；一次冷恢复继续创建关联的新 Run，原运行事实不可覆盖。
- BR-002：事件使用递增持久序号和稳定 eventId。完整 assistant 消息保留原 Tool Calls 分组，参数保存原始 JSON 字符串；并行工具按真实完成时间记录，但模型投影按有效消息配对规则构造。
- BR-003：获准执行的顶层工具必须先提交分派事件和 Ledger executing 占位。未获准、待审批和真正分派不得混为一类。
- BR-004：没有分派凭据只在所有执行路径都具备执行前持久化屏障时才能判为 TOOL_NOT_STARTED；其他无法证明的历史统一按未知处理。
- BR-005：已分派无持久结果为 TOOL_OUTCOME_UNKNOWN。Ledger succeeded 不能伪造模型结果，也不能据此重新执行工具；只允许核对或继续新请求。
- BR-006：已有真实结果按原文恢复；修复仅追加合成结果与中断边界，使用确定性身份防重复，不修改旧结果，不调用工具。
- BR-007：冷修复以持久 Session 事件为输入；同一进程内可从 AgentRunRegistry 识别活动运行并跳过修复。进程重启后没有活动运行，按 Session 日志重建中断状态；数据库不保存写入租约或 fencing token。
- BR-008：普通新消息先准备会话和修复旧尾部，再在该完整历史后追加新用户消息。无需用户提供 runId 或 callId。继续对话不构成对旧工具的直接重放授权。
- BR-009：新运行重新应用当前模型、工具可用性、路径权限及审批策略。过往批准、路径能力和旧配置不会自动成为新执行授权。
- BR-010：实际提供给模型的工具结果和上下文替换要持久化。原始外部大输出与模型可见内容分别标识；不能用易过期工件引用替代唯一可重建的模型可见文本。
- BR-011：对话页与轨迹页来自同一日志投影。旧 messages 表是兼容投影，最终回答及恢复回答须恰好投影一次。
- BR-012：默认预览只返回安全元数据，不直接展示敏感命令、文件正文或完整参数；用户明确展开详情时校验会话归属。内容按不可信文本渲染。
- BR-013：同一进程内由 ConversationScopeLock 阻止同一会话并发执行；Session 追加使用 lastSequence 比较并交换，冲突整批回滚。跨进程不维护写入所有权租约；不因只读轨迹浏览中断当前进程内的运行。
- BR-014：旧会话只导入真实持久消息和可证实的状态。无法还原的历史明确标注“历史轨迹不完整”，不补造。
- BR-015：搜索与类型过滤仅针对授权加载的预览；完整详情按需取回，不因搜索扫描或解密全部敏感正文。展示“在已加载轨迹中搜索”。
- BR-016：流式未提交尾部允许丢失，界面标注“中断时部分流式内容未保存”；不得将未保存尾部伪装为完整历史。
- BR-017：`AgentTracePanel` 以受控 props、回调和可选内容渲染器接入；网络、授权、路由、订阅与恢复动作由宿主负责。
- BR-018：删除会话时清除所属语义日志，跟随现有 Ledger 保留规则处理执行审计；备份不在删除承诺内。
- BR-019：无工具历史的回答可通过显式分支重生成；有工具历史时直接重生成返回 REGEN_REQUIRES_NEW_REQUEST，用户需发送新请求，原执行事实保留。

## 非功能约束

- NF-001：`@mint/session` 是纯 TypeScript 包，不依赖 SQLite、Express、Electron、React、ModelClient 或具体工具；`@mint/agent-ui` 只依赖公开轨迹 DTO 与 React，不能导入 apps。
- NF-002：Session 事件以 JSON 明文保存，不调用每事件加解密；API 密钥、凭据及独立工具 Ledger 的敏感参数继续按各自边界加密。日志、Langfuse、事件预览及错误默认不新增明文正文。
- NF-003：单次轨迹 API 默认 100、最大 500 条；持久游标与 SSE sequence 分开，分页不截断存储载荷。阈值为模块常量并由配置读取。
- NF-004：不逐 token 同步写 DB；语义边界提交必须完成后才允许下一次外部操作。批次必须原子有序。
- NF-005：CSS 使用包级命名空间与 custom properties；跟随 Mint 字体、颜色和主题。页签、搜索、过滤、行展开均可键盘操作，状态不用颜色单独表达。
- NF-006：HTTP 和 Electron IPC 通过声明式端点注册；新增包更新 workspaces、构建顺序、边界规则和桌面打包清单。
- NF-007：模型投影遵守上下文预算与摘要有效视图；完整日志留存不等于每轮无限追加全部内容。
- NF-008：损坏 JSON、损坏序列、未知必需版本必须阻止不可靠的模型重建；允许只读展示已验证前缀和明确缺口。

## 验收标准

以下是最低证据要求。原 AC-001…018 曾在非 Docker Harness 汇总为通过；TP-009 已修订 AC-010 并新增 AC-019/020，因此当前 AC-010、AC-019、AC-020 需重新验收。Docker smoke 按用户要求跳过。当前状态与证据见 traceability.md。

| AC     | 可观察声明                                                                                                                | risk   | invariants                                                                          | requiredEvidence           | probes                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| AC-001 | 会话事件按持久序号确定性投影，保留模型消息与工具调用的分组、顺序和配对，不修改输入。                                      | medium | contiguous_sequence, tool_pairing, detached_projection                              | unit                       | session-contract                                                                   |
| AC-002 | 每轮完整模型消息、模型可见工具结果及上下文变更均可从持久记录重建；可用的提供方消息字段按适配器契约保留。                  | high   | semantic_round_durable, context_provenance, provider_payload_preserved              | integration                | session-runtime                                                                    |
| AC-003 | 每条工具执行路径在正文产生副作用前持久提交分派凭据和 Ledger 占位；提交失败不执行。                                        | high   | intent_before_effect, atomic_dispatch_claim, fail_closed                            | integration, process-smoke | session-storage, session-crash                                                     |
| AC-004 | 实际模型可见工具结果在下一次模型请求前已持久化；Ledger 成功而结果缺失时仍禁止盲目重放。                                   | high   | result_before_next_model, success_without_result_no_replay                          | integration, process-smoke | session-runtime, session-crash                                                     |
| AC-005 | 冷恢复区分未分派、结果未知和已有结果，持久追加幂等修复，不自动执行旧工具。                                                | high   | not_started_proven, unknown_not_failure, repair_idempotence, no_auto_replay         | integration, process-smoke | session-recovery, session-crash                                                    |
| AC-006 | 同进程活动运行不被冷修复；进程重启后仅凭持久 Session 重建中断状态；追加按 lastSequence 比较并交换，冲突时整批回滚。       | high   | no_live_repair, session_reconstruction, sequence_cas, atomic_append                 | integration, process-smoke | session-recovery, session-crash                                                    |
| AC-007 | 普通新消息和恢复按钮使用同一历史构建入口，保留前序已完成调用与结果，保存新回答并关联 successor run。                      | high   | unified_history, successor_link, assistant_projection_once, no_history_loss         | integration, process-smoke | session-runtime, session-crash                                                     |
| AC-008 | 摘要和上下文替换可重建当前有效历史；恢复使用当前授权与适配器规则，不伪造 reasoning 或沿用失效审批。                       | high   | active_view_replay, current_authorization, no_reasoning_fabrication                 | integration                | session-runtime                                                                    |
| AC-009 | 旧会话仅导入真实消息并标记轨迹不完整；重复导入不重复，不补造历史调用、参数或结果。                                        | medium | legacy_partial_marked, no_fabricated_events, seed_idempotence                       | integration                | session-storage                                                                    |
| AC-010 | Session 事件按 JSON 明文保存且详情仍校验会话归属；凭据和独立 Ledger 的加密策略不变。                                      | high   | payload_json, scope_checked, no_session_decrypt, secrets_still_encrypted            | integration                | session-storage                                                                    |
| AC-011 | 历史快照和增量读取以同一持久游标衔接，重复或断线补拉不丢不重，HTTP 与 Electron IPC 返回同等语义。                         | high   | snapshot_watermark, cursor_gap_free, no_duplicate_rows, http_ipc_parity             | integration, process-smoke | session-api, session-transport                                                     |
| AC-012 | 独立 @mint/agent-ui 组件库可在最小 React 宿主运行，轨迹组件不导入 Mint API、路由、store 或服务端模块。                    | medium | portable_ui, no_host_imports, token_isolation                                       | integration, process-smoke | session-packages, session-ui-integration                                           |
| AC-013 | 聊天标题下提供可键盘操作的对话和轨迹页签；轨迹面板按 DeepSeek 参考布局呈现三泳道总览和有序事件列表。                      | medium | tabs_accessible, three_lane_layout, independent_panel, safe_content_render          | browser                    | browser-ac                                                                         |
| AC-014 | 轨迹面板支持时长、轮次、调用视图、搜索、类型过滤、总览定位及展开参数和结果，未知结果明确区别于执行失败。                  | medium | search_and_filter, selection_links_row, details_exact, unknown_distinct             | integration, browser       | session-api, browser-ac                                                            |
| AC-015 | 强退重启或刷新后，已提交轨迹及新旧运行关联仍可查看；未持久化的流式尾部和旧记录缺口有明确说明。                            | high   | restart_same_trajectory, successor_visible, no_duplicate_rows, partial_tail_marked  | process-smoke, browser     | session-crash, browser-ac, session-restart-browser                                 |
| AC-016 | 中断修复后用户可直接发送新问题；模型先获得原调用和未知结果再决定核对，输入草稿在切换轨迹页签时保留。                      | high   | repair_before_new_turn, no_automatic_retry, draft_preserved                         | integration, browser       | session-runtime, browser-ac, session-restart-browser                               |
| AC-017 | 删除会话清除所属事件与载荷；关闭时停止接纳、排空已提交写入，不再由后台任务访问已关闭存储。                                | high   | conversation_cascade, no_new_work, drain, no_background_access_after_close          | integration, process-smoke | session-storage, session-crash                                                     |
| AC-018 | ReAct、普通 stream 工具路径、审批继续、重新生成及取消均遵守统一记录规则，两个新包在 Web 和 Electron 构建中可加载。        | high   | react_stream_parity, approval_and_abort_preserved, web_electron_load                | integration, process-smoke | session-runtime, session-packages                                                  |
| AC-019 | 刷新或重启后聊天正文、推理和工具调用均从 Session 投影；删除兼容 messages 投影后聊天仍可重建，A2UI 按稳定 messageId 关联。 | high   | session_authoritative, chat_projection_complete, a2ui_linked, no_duplicate_messages | integration, browser       | session-authoritative-history, session-chat-ui-projection, session-restart-browser |
| AC-020 | 迁移一次性解密既有事件到 payload_json；迁移后新写入和读取均不依赖加解密，旧事件内容和顺序保持一致。                       | high   | legacy_payload_preserved, plaintext_json, migration_atomic, no_read_decrypt         | integration                | session-storage, session-authoritative-history                                     |

## 风险与依赖

依赖现有工具参数快照变更 `2026-10-20-tool-invocation-arguments`，其本地未提交实现不是已发布事实。实施前须核对迁移编号与实际代码。主要风险包括消息双写不一致、错误修复活运行、旧审批被复用、提供方 reasoning 协议不兼容，以及敏感正文通过轨迹预览泄露。

完整性目标从新日志启用后成立。旧记录、未提交的流式尾部、外部原始结果及已失效工件均不得宣称已完整恢复。

## 追溯与状态

US-001 → FP-001…007/011/012、BR-001…011/013/014/016/018、NF-002/003/004/007/008 → AC-001…011/015…020。
US-002 → FP-007…010、BR-012/015/016、NF-003/005 → AC-010/011/013…016。
US-003 → FP-001…007/011/012、BR-002/006/007/010/011/018、NF-001/002/004/007 → AC-001…011/017…020。
US-004 → FP-003/008/009、BR-017、NF-001/005/006 → AC-001/012/013/018。
逐项 DS 与 TP 对应见 traceability.md。无实现完成声明。
