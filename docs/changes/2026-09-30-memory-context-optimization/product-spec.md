# 产品规格：记忆分层、空间召回与上下文预算

## 文档信息

| 属性     | 值                                           |
| -------- | -------------------------------------------- |
| 编号     | SPEC-20260930-MEMORY                         |
| 任务     | 260930｜[Mint]｜记忆机制改造方案             |
| 状态     | 已实现；AC-001～AC-013 均通过 Harness 验收   |
| 创建日期 | 2026-09-30                                   |
| 关联设计 | [design-doc.md](design-doc.md)               |
| 执行计划 | [exec-plan.md](exec-plan.md)                 |
| 追溯     | [traceability.md](traceability.md)           |
| 参考证据 | [source-assessment.md](source-assessment.md) |

## 背景与目标

当前 Mint 每轮选取最多 24 条 active semantic 记忆，再用最新用户输入做最多 8 条 SQL LIKE 检索，按 ID 去重后拼接完整正文。它已有数量限制，但 semantic 不等同于稳定画像，条数也不能保证上下文开销。中文整句、同义表达、跨空间事实和有效期还需要专门处理。

参考 agentmemory 的 core/archival 分层、pinned 内容、预算组装、独立检索入口和访问记录，建立“少量常驻画像 + 按问题召回事实”。本变更同时按 Server 结构提案收敛 Memory 领域的责任和导入边界。

目标是让记忆库持续积累时，单次注入仍有可观察的开销上限；用户可以管理常驻内容和知识空间归属；问题只使用当前空间和全局范围内的有效事实。

## 用户、场景与术语

- 用户：当前 Mint 本地数据库的使用者；本期不引入多用户租户模型。
- 全局记忆：跨知识空间可使用的用户信息。
- 知识空间：用户明确创建和选择的记忆作用域。当前没有通用 workspace/knowledge-space ID，本期新增最小记忆空间记录作为载体；未来工作区通过公共接口映射该 ID。
- 未归属：旧记忆或缺少可靠归属的信息；可在管理页查看，不能自动参与回答。
- 常驻画像：有效且标记为 core 的少量记忆，包括稳定用户画像及用户指定的当前空间摘要。
- 按需事实：标记为 retrievable 的记忆，经相关性筛选后参与当前请求。
- 固定/常驻：提高选择优先级，仍受预算约束。
- 本期“预算不超限”指项目 token 估算器对最终消息的估算值；不宣称等于提供商真实 tokenizer 的计数。

用户已确认：作用域按 Mint 工作区/知识空间设计；未绑定时使用用户全局记忆。实施载体是本期新增的最小知识空间，不把仓库路径、Agent ID、分类 project 或 wikiPath 当作空间 ID。

## 用户故事与功能点

| ID     | 用户故事                                               | 功能点                                         |
| ------ | ------------------------------------------------------ | ---------------------------------------------- |
| US-001 | 用户希望常用偏好能跨对话延续，同时避免无关项目内容常驻 | FP-001：显式 core/retrievable 策略与可编辑画像 |
| US-002 | 用户在不同知识空间中提问，希望事实归属清楚             | FP-002：知识空间管理、会话绑定和范围过滤       |
| US-003 | 用户用中文询问历史事实，希望能找到相关记录             | FP-003：中文词法召回、相关性门槛与空结果       |
| US-004 | 用户修正或撤销事实，希望旧值停止影响回答               | FP-004：有效期、版本替代、事务与索引同步       |
| US-005 | 用户希望普通聊天、Agent 和桌面端有一致记忆行为         | FP-005：请求快照、预算组装及入口兼容           |
| US-006 | 维护者希望扩展记忆能力时能定位职责和验证影响           | FP-006：Memory 领域结构、观测和评估证据        |

## 范围与非目标

本期交付：Memory 领域整理、保守的数据迁移、core/retrievable 策略、最小知识空间及会话绑定、中文词法召回、预算组装、写入作用域快照、管理界面和验收探针。AC-001～AC-013 的实现与证据状态见 [traceability.md](traceability.md) 和最终 Harness run `2026-10-01T03-18-43-494Z-40308`；token 预算仍按项目估算器解释，不代表供应商 tokenizer 的实测账单值。

后续方向：向量混合召回、Agent 记忆检索工具、经验反思、会话摘要、自动降温和图关系扩展。它们不计入本期完成标准，需各自的效果与生命周期证据。

不在本期创建统一文件工作区系统、重构 Wiki 内容作用域、替换 iii-engine、引入外部记忆服务、拆 npm workspace 或整体搬迁 Server 入口。知识空间只隔离记忆，不能据此宣称 Wiki 搜索也已隔离。

## 业务规则

| ID     | 规则                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-001 | memoryType 与 contextPolicy 独立。semantic/episodic/procedural 表示内容类型，core/retrievable 表示注入策略；category 只用于分类展示。                                       |
| BR-002 | 新自动提取默认 retrievable。只有显式稳定用户事实、global/user 主体、限定画像键且 confidence ≥ 0.8，才能自动进入 core；用户手工设置优先，模型不能覆盖 policySource=user。    |
| BR-003 | 无空间绑定只读 global；有效绑定 A 只读 global 与 A。无效、已归档或请求中伪造的空间不能退回跨空间搜索。事实更新、NOOP、DELETE 和去重同样遵守空间边界。                       |
| BR-004 | 只有 active 且 validFrom ≤ 请求时刻、validTo > 请求时刻的记录可注入；null 表示无该端界限。非法时间、未知状态/策略、未归属记录不注入；时间使用 UTC ISO，结束时刻为排他边界。 |
| BR-005 | 默认记忆上限 2,000 estimated tokens，其中 core 上限 500；还受可用请求预算限制。包装、标题、主体、来源说明和消息开销全部计入。固定项、单条长内容也不得突破上限。             |
| BR-006 | 常驻项先按用户指定优先，再按确定性顺序选择；相关事实以查询相关性为主，重要性与时效为辅助。无法完整装入时跳过该事实，不截断否定或条件语句；没有合格事实可返回空。            |
| BR-007 | 查询采用当前问题和最多两条近期用户原始消息，最多 600 字符；不使用模型回答、工具结果或已注入记忆扩展查询。词法召回不承诺无词面重合的同义语义理解。                           |
| BR-008 | 作用域在用户消息持久化前固定，并用于本轮助手消息与提取作业。后续切换空间不能改变旧消息/作业的归属，也不能把整段跨空间历史送入一次提取。                                     |
| BR-009 | 旧记忆全部迁为 retrievable/unassigned，保留 ID、正文、状态、来源与版本链，显示“历史记忆待归属”；用户可逐条或批量指定 global/知识空间。迁移不猜测项目、不自动提升画像。      |
| BR-010 | 事务、解析拒绝不降级写入、任务快照重排队、门控不可用回退、SSE 完成后异步提取和 runtime 关闭顺序继续成立；关键词索引与有效事实变更同事务提交。                               |
| BR-011 | memoryEnabled=false 时不做记忆召回、门控、入队或提取；管理界面仍可查看和编辑。功能开启后读取失败安全省略记忆，主聊天继续；无效绑定仍按 BR-003 拦截。                        |
| BR-012 | 动态记忆作为参考数据置于最新用户消息前，不获得系统指令权限。单个 run 固定候选快照；上下文压缩处理基础历史，随后组装一次记忆，不能把记忆反复压入摘要再重复注入。             |
| BR-013 | 访问计数仅表示实际装入请求，不表示模型使用或答案正确；不据此自动提升 core。普通日志不含正文、查询、完整路径或原始模型响应。                                                 |

### 输入、错误与反例

- contextPolicy 只接受 core/retrievable；scopeKind 只接受 global/space/unassigned。space 必须有存在且未归档的 spaceId，其他范围必须为 null。未知枚举返回 400/MEMORY_INPUT_INVALID。
- 有效期必须可解析且 validFrom < validTo；空字符串非法，null 清除。语义不合法返回 400/MEMORY_INPUT_INVALID。
- 不存在的记忆或空间返回 404/MEMORY_NOT_FOUND 或 MEMORY_SPACE_NOT_FOUND；已归档空间或绑定操作时会话正在生成回复返回 409/MEMORY_SPACE_UNAVAILABLE 或 MEMORY_CONVERSATION_BUSY。
- 批量归属 1～100 个 ID，一项不存在或非法则整批回滚；不能部分成功后显示整批成功。
- 同一 scope + memoryKey + subject 的单值事实冲突不能依靠两个 core 项同时注入解决；必须明确更新/撤销或返回 409/MEMORY_FACT_CONFLICT。general/旧分类键不当作单值事实键。
- 反例：category=project 不代表属于空间 A；A 的 database 字段不能替代 B 的 database 字段。
- 反例：用户把 5,000 字事实设为常驻，不会绕过预算；界面仍显示已设置，实际未注入原因可在诊断中查看。
- 反例：请求过程中从 A 切换到 B，不会把本轮 A 的对话提取成 B 的记忆；此时 UI 绑定操作返回明确 busy，待 run 结束后可切换。
- 反例：历史记忆未归属时没有召回结果，不等于数据丢失；管理页必须展示迁移说明和归属入口。

## 非功能要求

| ID     | 要求                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-001 | 同一输入、数据库快照、请求时间与配置得到相同选择和顺序；token 预算不依赖记忆总条数。                                                            |
| NF-002 | 默认召回只访问本地 SQLite，不增加前台模型/embedding API 请求；1 万条 fixture 上召回及组装 p95 ≤ 100ms，记录硬件和样本，不能以环境差异伪造通过。 |
| NF-003 | schema 用 migration；启动失败关闭；不自动降级到未迁移 schema；实施前保留数据库备份，旧版本二进制不能直接读取升级后 DB。                         |
| NF-004 | 遵循单包、领域公共接口、无新循环依赖；前端使用 design tokens 与 Radix 控件，新增端点通过声明注册并覆盖 HTTP/IPC/manifest。                      |
| NF-005 | 不把 agentmemory 的宣传指标、mock 回复或命令 exit code 当作 Mint 的模型效果与真实环境证据。                                                     |

## 验收标准与证据契约

以下验收契约已由最终 Harness run `2026-10-01T03-18-43-494Z-40308` 聚合为 PASS；各项所需证据与不变量明细见 [traceability.md](traceability.md)。risk 使用 low/medium/high；跨模块与生命周期 AC 不只依赖 static/unit。

| AC     | 可观察验收行为                                                                                                                         | risk   | invariants                                                    | requiredEvidence           | TP / probes                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------- |
| AC-001 | core 与类型/分类独立；迁移保留旧记录及版本来源；未归属可管理但不能召回                                                                 | high   | migration_preserves_data, no_unassigned_recall                | integration                | TP-003、TP-007 / memory-integration、browser-ac                |
| AC-002 | 最终记忆消息估算值 ≤ 有效预算；core ≤ 500；固定项与超长事实不突破，零预算无空包装                                                      | medium | bounded_memory_tokens, deterministic_selection                | unit, integration          | TP-005、TP-006 / memory-unit、memory-entry                     |
| AC-003 | 无绑定只读 global；绑定 A 不读 B；伪造、已归档空间不扩大范围；同键写入不跨空间替代                                                     | high   | scope_isolation, no_scope_fallback                            | integration                | TP-003、TP-004、TP-006 / memory-integration、memory-entry      |
| AC-004 | 中文短语/技术标识符词法命中；零合格词面匹配时不注入；返回项满足相关性与数量规则                                                        | medium | relevant_recall, abstain_when_unmatched                       | unit, integration          | TP-004 / memory-unit、memory-integration                       |
| AC-005 | 过期/未来/撤销/被替代/非法状态事实不注入；更新与索引同事务；失败后无半更新                                                             | high   | active_valid_only, atomic_index_update, rollback              | integration                | TP-003、TP-004 / memory-integration                            |
| AC-006 | 作业按消息快照及空间绑定版本处理；重复幂等，新快照重排；切换空间不混合旧轨迹                                                           | high   | snapshot_scope_immutable, idempotence, ordering               | integration                | TP-003、TP-006 / memory-integration、memory-entry              |
| AC-007 | 关闭记忆后上下文召回、门控、入队与提取调用均为零；管理 CRUD 仍可使用                                                                   | medium | memory_disabled_no_work                                       | integration, browser       | TP-006、TP-007 / memory-entry、browser-ac                      |
| AC-008 | 普通/Agent/ReAct、CLI chat/REPL 与 Electron 使用相同选择；一次模型调用最多一个记忆块；压缩后不重复，SSE 顺序保留                       | high   | cross_entry_consistency, no_duplicate_injection, sse_ordering | integration, process-smoke | TP-006、TP-008 / memory-entry、memory-process、electron-smoke  |
| AC-009 | 用户创建空间、绑定/解除会话、设置/取消常驻、批量归属后重开回显一致；非法输入/冲突可见；HTTP 与 IPC 对应字段一致                        | high   | user_policy_preserved, persistence_roundtrip, endpoint_parity | integration, browser       | TP-007 / memory-integration、browser-ac                        |
| AC-010 | Memory 源码和测试按目标领域归位；入口只用公共接口；无新循环/深层跨域导入，已知入口构建解析一致                                         | high   | domain_boundary, regression_free, import_side_effect_free     | integration, static        | TP-001、TP-002、TP-008 / boundary、memory-static、memory-entry |
| AC-011 | 停止后不接收新记忆作业，已启动任务受控结束；SQLite 关闭后无记忆/访问统计写入；重启恢复不重复                                           | high   | no_new_work, drain, no_write_after_db_close, idempotence      | integration, process-smoke | TP-002、TP-006、TP-008 / memory-lifecycle、memory-process      |
| AC-012 | 诊断输出实际入选数量、估算 token、候选和跳过原因；失败日志不含正文/查询/原始响应，访问统计只计入选                                     | medium | content_free_observation, selected_access_only                | unit, integration          | TP-005、TP-008 / memory-unit、memory-integration               |
| AC-013 | 固定至少 30 个标注案例；词法可回答子集 Recall@8 ≥ 0.85，无关注入率 ≤ 0.10，跨空间误取为零；1 万条 fixture p95 达标；留存新旧基线及局限 | medium | measured_retrieval_quality, reproducible_baseline             | integration                | TP-008 / memory-quality                                        |

## 风险、依赖与交付边界

- 旧记忆保守迁为未归属会暂时降低个性化；需迁移提示与批量归属，不能静默丢弃。
- 当前没有知识空间实体；本期最小元数据及会话绑定必须一起实施，不能只加 spaceId 字段却无用户入口。
- ContextProvider 是 HIGH 影响链路，Memory 构建函数的 UNKNOWN 图结果不能当作安全结论；详见评估。
- 词法检索对无词面重合的同义提问有限；评估单列该类，不靠筛掉困难案例宣称语义召回通过。
- 未使用真实模型 API 或外部 ingest。质量结论只覆盖固定词法案例、SQLite fixture 和本地入口；不能外推为语义检索或真实模型遵循效果。

## 追溯

| 需求组                                                    | 设计                   | 任务                           | 状态   |
| --------------------------------------------------------- | ---------------------- | ------------------------------ | ------ |
| US-001 / FP-001 / BR-001、BR-002、BR-005、BR-006          | DS-003、DS-005         | TP-003、TP-005、TP-007         | 已完成 |
| US-002 / FP-002 / BR-003、BR-008、BR-009                  | DS-002、DS-007、DS-008 | TP-003、TP-006、TP-007         | 已完成 |
| US-003 / FP-003 / BR-007 / NF-002                         | DS-004、DS-009         | TP-004、TP-008                 | 已完成 |
| US-004 / FP-004 / BR-004、BR-010                          | DS-002、DS-007         | TP-003、TP-004、TP-006         | 已完成 |
| US-005 / FP-005 / BR-011、BR-012                          | DS-006、DS-007、DS-008 | TP-006、TP-007、TP-008         | 已完成 |
| US-006 / FP-006 / BR-013 / NF-001、NF-003、NF-004、NF-005 | DS-001、DS-009、DS-010 | TP-001、TP-002、TP-008、TP-009 | 已完成 |
