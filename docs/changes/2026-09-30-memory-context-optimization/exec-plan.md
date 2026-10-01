# 执行计划：记忆分层与 Memory 领域收敛

## 文档信息

| 属性     | 值                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------ |
| 编号     | PLAN-20260930-MEMORY                                                                                   |
| 状态     | 已完成；TP-001～TP-009 全部完成，AC-001～AC-013 全部 PASS                                              |
| 关联     | [product-spec.md](product-spec.md)、[design-doc.md](design-doc.md)、[traceability.md](traceability.md) |
| 计划规模 | L2；schema、入口、后台生命周期、用户管理与领域迁移                                                     |

## 完成定义与当前交付

已完成定义：全部 TP 实施，所有 AC 的 requiredEvidence 与 invariants 均由 Harness claims 聚合为 PASS；入口、生命周期、UI、质量与性能证据和限制已记录。最终 Harness run 为 `2026-10-01T03-18-43-494Z-40308`。

归档说明：实现与验证已完成；没有独立第三方审阅，本次主代理审计能力降级，见 `verify-consistency.md`。不据此声称上位 Server 结构提案的其他任务完成。

## 范围、前置条件与顺序

- 允许路径：Memory 领域、专属 infrastructure、bootstrap/memory、端点与客户端记忆/绑定入口、migration/types、ContextProvider/必要运行时接缝、测试与构建清单。高影响入口仅改调用/契约接缝，不整体搬迁。
- 保留既有 `docs/mint-project-interview-qa.md` 未跟踪文件；不读取/修改用户真实数据库，不使用真实模型 API做方案验证。
- 开始 apply 前将状态改为执行中；刷新图、重新运行影响分析，盘点所有静态/动态引用及已存在修改。HIGH/CRITICAL 必须报告；UNKNOWN 补充源码/配置盘点。当前图证据不是后续实施的永久许可。
- 新 migration 编号以执行时当前 registry 分配，不提前占用数字。
- TP-002 完成行为保持验证后，才进入 schema/产品行为批次。TP-003 → TP-004/TP-005 → TP-006 → TP-007 → TP-008 → TP-009；默认顺序执行，避免共享入口与迁移冲突。
- 关联结构提案只由本变更细化 Memory 领域，不将其其余 TP 状态改成已完成。

## 任务总览

| TP     | 任务                                        | 状态   | 设计                   | AC                                             |
| ------ | ------------------------------------------- | ------ | ---------------------- | ---------------------------------------------- |
| TP-001 | 固定依赖/接口基线并实现 Memory 领域边界规则 | 已完成 | DS-001、DS-010         | AC-010                                         |
| TP-002 | 行为保持的领域拆分、仓储/adapter/装配归位   | 已完成 | DS-001、DS-007、DS-010 | AC-010、AC-011                                 |
| TP-003 | schema、空间与消息作用域快照迁移            | 已完成 | DS-002、DS-003、DS-007 | AC-001、AC-003、AC-005、AC-006                 |
| TP-004 | 独立 FTS5 投影与中文词法召回                | 已完成 | DS-004、DS-002         | AC-003、AC-004、AC-005                         |
| TP-005 | 画像准入、确定性装入、预算与诊断            | 已完成 | DS-003、DS-005、DS-009 | AC-002、AC-012                                 |
| TP-006 | 请求快照、普通/ReAct 接入与后台处理         | 已完成 | DS-006、DS-007         | AC-002、AC-003、AC-006、AC-007、AC-008、AC-011 |
| TP-007 | 声明端点、HTTP/IPC 与用户管理闭环           | 已完成 | DS-008、DS-003         | AC-001、AC-007、AC-009                         |
| TP-008 | 固定案例、进程/桌面/入口及 Harness 证据     | 已完成 | DS-009、DS-010         | AC-008、AC-010、AC-011、AC-012、AC-013         |
| TP-009 | AC 聚合、审阅与文档收敛                     | 已完成 | DS-010                 | AC-001～AC-013                                 |

## TP-001：依赖基线与领域检查

- 前置：工作区快照、GitNexus 最新索引、当前上位提案审阅。
- 工作：盘点 memoryService/Job/Repository/gates/context/types 的调用方、dynamic imports、vi.mock 路径、endpoints manifest、CLI、eval、Electron/MCP bundle。核实 buildMemoryContext 的引用别名；固定领域公共出口及引入接口的范围。
- 产出：`docs/architecture/LAYERS.md` 的 Memory 边界；`server/architecture/__tests__/memoryBoundary.test.ts` 与旧边界检查对新目录的认识；引用清单和逐符号风险记录。
- Probe：`node .gitnexus/run.cjs status`、目标 `impact`、`npm run --workspace=mint-server test:boundary`；检查 import/export/literal dynamic import 解析及循环，故意构造跨域内部导入验证规则能拒绝，不能仅扫描旧层级目录。
- 证据：`evidence/implementation/TP-001/` 下图摘要、入口清单、边界检查结果；所有输出按实际文件登记。
- 停止条件：UNKNOWN 且引用无法补足，或迁移触发未声明外部契约变化；缩小该批，先修接口。

## TP-002：领域拆分与归位

- 前置：TP-001；拆分前保持当前返回内容与副作用语义。
- 工作：按 DS-001 将管理/context/parser/operation/extraction/jobs/gates 拆入 domains/memory；专属持久化和外部调用进入 infrastructure；bootstrap 显式连接 Settings/Transcript/Extraction/Gate。把 Worker 散落状态收为工厂对象，统一 start/stop/drain 所有权。
- 产出：DS-001 文件树与对应测试；memoryContextProvider、messageService、endpoints、ServerRuntime 的公共接口导入；旧入口 facade 清单和退出条件；类型 re-export。
- Probe：现有 memoryService、memoryP0Repository、memoryJobService.lifecycle、memoryGatePolicy/jevMemoryGate、contextProvider、messageService 与 lifecycle suites，迁移时跟随实际路径；`npm run typecheck`、`npm run build`、`npm run --workspace=mint-server build:bundle`、`npm run --workspace=mint-server build:mcp`、boundary。
- 证据：迁移前后路径、adapter 请求/作业状态契约对照、编译/manifest/bundle 结果。此批不得声称新画像/空间能力已实现。

## TP-003：数据迁移与作用域

- 前置：TP-002；隔离 DB fixture 与备份/恢复流程，不使用真实用户 DB。
- 工作：创建 contextPolicy/policySource/scope、memory_spaces、会话绑定 revision、message scopes、jobs 复合唯一键、审计字段和 FTS 结构。实现状态/时间校验，单值键作用域事务、批量归属/冲突；先完善数据层后连接用户入口。
- 产出：`server/migrations/index.ts` 新 migration；persistence 三类仓储；memorySpaceService/operationService/types；`migration.integration.test.ts`、`scope.integration.test.ts`、`snapshot.integration.test.ts`。
- Probe：memory-integration。比较旧 fixture 前后所有 ID/正文/source/status/version；旧 jobs 不被误写全局；A→B→A revision、归档/解绑、伪造空间、同键跨空间 UPDATE/DELETE、批量回滚、时间边界；migration 故障时启动失败关闭。
- 证据：迁移前后数据摘要、索引检查、事务故障注入结果。记录旧记忆全部未归属造成的个性化变化和 UI 提示要求。

## TP-004：FTS5 与词法召回

- 前置：TP-003；索引投影与操作事务共用连接/transaction。
- 工作：实现共享于 index/query 的纯 token 化和版本；参数化 FTS OR 查询、scope/status/time 过滤、覆盖率门槛、最多 40 候选/8 合格项、稳定排序与降级。清除旧 LIKE 回答路径与 findAll 注入 fallback。
- 产出：memoryQuery.ts、memorySearchRepository.ts、memoryContextService 的候选读取；`memoryQuery.test.ts`、`retrieval.integration.test.ts`。
- Probe：memory-unit、memory-integration。中文双字、单字、混合标识、FTS 特殊字符、停用词、边界 coverage、无匹配、当前/其他空间；索引失败不遗留半条新事实，索引异常不全量兜底。
- 证据：查询/候选 fixture 的受控报告、SQL/FTS 状态和 tokenization version。明确同义无重合属于后续能力。

## TP-005：画像策略与预算

- 前置：TP-003，召回连接依赖 TP-004。
- 工作：白名单画像准入、用户策略继承、显式同键遮蔽；完整事实为单位装入，包装与 overhead 复算；escape XML；确定性排序、skip 枚举及只计入选访问。
- 产出：memoryPolicy.ts、memoryContextPacking.ts、memoryContextService；`memoryPolicy.test.ts`、`memoryContextPacking.test.ts`、`observation.integration.test.ts`。
- Probe：memory-unit、memory-integration；大量记录/零预算/固定长内容/全是无效记录、两个相同键、伪 closing tag、否定语句不截断；敏感 fixture 不进日志；实际入选计数与 access 更新一致。
- 证据：最终消息估算值、输入→选择结果、跳过原因和日志检查产物；tokenEstimator 的模型差异记录。

## TP-006：请求、作业与生命周期接入

- 前置：TP-003～TP-005；applyContextProviders HIGH 风险复核。
- 工作：消息持久化捕获作用域，ContextProvider 收集/组装贡献分离；普通与 ReAct 基础历史预留贡献预算、压缩后单次注入；候选在 run 内冻结，下一轮只重新装入不再检索。afterAssistantPersisted 继续 SSE 完成后门控，按 revision 入队；TranscriptPort 不混轨迹；off 后读/门控/提取均零。
- 产出：ContextProvider、memoryContextProvider、messageService/必要 reactLoopCore 接缝；memoryJobService/ports/bootstrap；`entry.integration.test.ts`、`worker.lifecycle.integration.test.ts` 与当前 message/runtime tests 更新。
- Probe：memory-entry、memory-lifecycle、memory-process。捕获普通/Agent/ReAct 请求，强制压缩多轮检验记忆块恰好一个；工具历史增长/预算为零、Jev skip/unavailable、任务并发快照、空间切换；真实停止/重启及 DB-close 后写入为零。
- 证据：request fixture/SSE 事件顺序、SQLite 快照与实际进程退出结果。mock 只作局部证据，不替代关闭与桌面进程。

## TP-007：端点与用户流程

- 前置：TP-003～TP-006，服务错误/策略契约已可集成验证。
- 工作：实现 API-001～API-006；同步 endpointRegistry、client API、preload、ElectronAPI、manifest。最小知识空间管理、会话绑定、常驻开关、待归属提示/批量归属、有效期与错误回显；使用 Radix 和 design tokens。
- 产出：endpoints/definitions/{memories,memorySpaces,conversations}、client/src/services/api/、settings/记忆与 chat/header 绑定组件、类型/样式、endpoint/IPC 集成 tests、当前目录 browser-scenarios。
- Probe：memory-integration 验证真实 DB 与 HTTP/IPC 字段/错误一致；browser-ac 验证用户完整操作与请求。补全 fixture、严格请求体断言在 integration/browser 可执行代码中完成，不能只以网络包含 PUT 证明 payload 正确。
- 证据：browser tracing/network/screenshots 与持久化往返断言；scope 隔离仍由后端 fixture证明，browser mock 不证明真实召回。

## TP-008：质量与入口综合验证

- 前置：TP-001～TP-007，所有拟新增 probe 文件已实现。
- 工作：创建 ≥30 固定标注案例与 1 万条基准；保存当前 24+8 基线与新结果；实现 CLI/REPL 进程级 memory smoke、SQLite 停止/重启 probe，补充 Electron bundle 的 memory 能力实测。
- 产出：`domains/memory/__tests__/fixtures/recall-cases.json`、`quality.integration.test.ts`、`scripts/memory-process-smoke.mjs`、`scripts/memory-verification.mjs`；基准与入口报告；必要时更新现有 electron-lifecycle-smoke 的记忆请求检查，不把仅启动等同于功能证据。
- Probe：memory-quality、memory-process、electron-smoke、memory-static、boundary，加本期全部 probes。新 launcher 读取本目录 harness-checks.json 并以数组参数传给 Harness，不通过字符串 shell 拼接执行。
- 证据：固定 cases、排序结果、分母、基线、p50/p95/硬件，真实 CLI/REPL/Electron 请求与关停。若真实环境缺失则对应 AC=BLOCKED/UNVERIFIED，不降到 mock 后标 PASS。
- 不做真实模型效果跑分或外部 ingest；如需后续 live run，先明确发送的数据和目的。

## TP-009：聚合、审阅和交接

- 前置：TP-008；逐 AC artifacts 已存在。
- 工作：逐条聚合 requiredEvidence 和 invariants；检查 US/FP/BR/NF→DS/API→TP/AC；记录偏差，更新关联结构提案的 Memory 映射但不推进其他领域任务。必要时请求独立审阅；没有独立审阅时标明审计能力降级。
- 产出：verify-consistency.md、check-doc.md、实际执行记录、最终追溯/索引与债务清单。
- Probe：Harness verify、文档引用/ID、Prettier、git diff --check；提交前 GitNexus detect_changes，partial/truncated 必须继续补足，不能把零当作无影响。
- 归档条件：所有本期 AC PASS，实际证据满足，不含 BLOCKED/UNVERIFIED/FAIL，独立审查和债务一致。否则只交付阶段结果。

## 可执行 probe 目录

以下 probe 已在最终 Harness run 中执行。完整参数与证据等级以 [harness-checks.json](harness-checks.json) 为准，机器 AC 契约见 [verification-plan.json](verification-plan.json)。

| probe              | 实际执行命令/范围                                                                    | evidenceLevel | 证据                                                        |
| ------------------ | ------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------- |
| server-regression  | `npm run --workspace=mint-server test`                                               | integration   | 全量 server Vitest log                                      |
| client-regression  | `npm run --workspace=mint-client test`                                               | unit          | 全量 client Vitest log                                      |
| memory-unit        | memoryQuery、memoryCorePolicy、memoryContextPacking、memoryService tests             | unit          | `memory-unit.log`                                           |
| memory-integration | migration、memory repositories、space service 与 endpoints tests                     | integration   | `memory-integration.log`                                    |
| memory-entry       | entry integration 与 ContextProvider tests                                           | integration   | adapter/SSE/selected IDs                                    |
| memory-lifecycle   | worker lifecycle 与 ServerRuntime tests                                              | integration   | drain/no-new-work/DB-close                                  |
| memory-quality     | 固定 30 cases、10k isolated SQLite fixture、100 次 latency measurement               | integration   | `quality-report.json`                                       |
| memory-process     | `node scripts/memory-process-smoke.mjs`                                              | process-smoke | CLI chat/REPL、重启与持久化                                 |
| browser-ac         | `node .harness/browser-scenario.mjs --change 2026-09-30-memory-context-optimization` | browser       | 四个场景 tracing/network/screenshots                        |
| memory-static      | `node scripts/memory-verification.mjs --static-only`                                 | static        | typecheck、boundary、server/Electron/MCP/client builds      |
| boundary           | `npm run --workspace=mint-server test:boundary`                                      | integration   | layer 与 Memory domain checks                               |
| coverage           | `npm run --workspace=mint-server test:coverage`                                      | static        | 全量 coverage report                                        |
| electron-smoke     | `node scripts/electron-lifecycle-smoke.mjs`                                          | process-smoke | bundle scope CRUD/recall、HTTP 200、shutdown/no-after-close |

最终完整执行命令：`node scripts/memory-verification.mjs --change 2026-09-30-memory-context-optimization`；结果与证据路径见最终 Harness run 与 `evidence/implementation/TP-008/memory-verification.json`。

## 风险、回退与证据控制

- schema 与队列唯一键的改动风险高；domain 移动先独立完成，迁移前备份/隔离 DB，并留新旧 fixture 数据比较。
- 旧数据全部未归属是明确产品变化；缺少 UI 提示或批量入口时不得发布。
- 中文 token 门槛与性能参数是待实测的设计初值；质量门禁未过需调参/补能力后再验，不改分母或删除失败案例。
- 若需要扩大到 Wiki scope、统一工作区或新增后台 embedding 作业，进入新变更，避免悄悄扩范围。
- entry mocks、浏览器 mocks、进程实测与真实模型质量分开；产物至少记录输入 snapshot、观察值、命令、时间、环境和 AC，不只保存 exit code。
- 高影响批次后运行项目要求的 Prettier 检查与 git diff --check，必要构建；禁止 --no-verify。

## 执行记录

### TP-001（已完成）

- 开始日期：2026-09-30。
- 基线：HEAD `2fe23f45137cffdbcc229de3763001154d210207`；既有未跟踪文件 `docs/mint-project-interview-qa.md` 已排除于本次变更。
- 图证据：`applyContextProviders` 影响 HIGH，调用者 `sendMessage`，关联 HTTP messages、CLI chat 和 REPL；`buildMemoryContext` 影响为 UNKNOWN，源码确认由 memory provider 默认参数别名调用。图结果不替代动态引用与测试盘点。
- 环境基线：Node 20.19.4；better-sqlite3 可加载；`npm run harness:test` 18 项通过。
- 局部测试基线：记忆服务、事务仓储、worker 生命周期、Jev 门控与 ContextProvider 共 51 项通过。
- 产出文件：`server/architecture/memoryBoundary.ts`、`server/architecture/__tests__/memoryBoundary.test.ts`、`server/architecture/__tests__/boundary.test.ts`、`docs/architecture/LAYERS.md` 与 `evidence/implementation/TP-001/`。
- 验证：Server boundary 5 项通过；typecheck、server build、Electron bundle、MCP bundle 通过；Harness 自测 18 项通过；Prettier 与 `git diff --check` 通过。
- 图和调用清单：`evidence/implementation/TP-001/` 保存影响 JSON 与源码消费者清单。GitNexus 为文档未索引而 stale，代码 HEAD 未变；流程采样截断，结构检查还依据源码/endpoint/Electron 清单。
- 问题：无实现问题。ContextProvider HIGH 和 memory context UNKNOWN 持续作为 TP-002/TP-006 风险；AC-010 需在整个迁移完成后再验。

### TP-002 变更前基线

- 开始日期：2026-09-30。
- 允许范围：Memory 类型、仓储、服务、门控、worker、adapter 及已知消费者；保持 HTTP/SSE、DB 记录和 gate 语义。
- 已知消费者：message/context provider、memory endpoint、ServerRuntime、eval、Electron bundle 与 Jev questions，均记录在 `evidence/implementation/TP-001/baseline.json`。
- 行为保持拆分前 51 项 memory 相关回归已通过。模块拆分后的每批结果随后追加。

### TP-002（已完成）

- 完成日期：2026-09-30。
- 产出：`server/domains/memory/`、`server/infrastructure/persistence/`、`server/infrastructure/ai/`、`server/bootstrap/memory.ts`；消息、endpoint、ServerRuntime、eval、Electron/MCP bundle consumers 切换到新公共入口；增加 Memory 专属边界规则。
- 验证：原 Memory focused suites 51 项基线通过；迁移前既有回归、typecheck、server build、Electron bundle、MCP bundle 与 Harness checks 通过。TP-003 合并后当前重新运行 66 项相关测试及 typecheck，通过；完整 Harness 和产品 AC 验收仍未完成。
- 风险：AC-010 还需最终入口构建、boundary 和 Harness 证据；生命周期行为仍由 TP-006/TP-008 验收。

### TP-003（已完成）

- 开始日期：2026-09-30。
- 产出：migration #32 `add-memory-scopes-and-retrieval-index`；知识空间与 conversation binding repository/domain service；message snapshot 原子持久化；按 `(conversation_id, binding_revision)` 的 memory jobs；隔离 transcript 查询；记忆操作和审计写入 scope metadata；批量归属冲突整批回滚。
- 验证：migration/schema/space/snapshot/job/message/service focused suites 通过；`npm run --workspace=mint-server typecheck`、server build、`test:boundary` 通过。migration fixture 覆盖旧事实保留、pending/processing 隔离、重复迁移及 DDL 故障回滚；A→B→A 版本与 transcript 隔离、重复绑定、归档、冲突批量回滚和日期区间校验通过。完整结果见 `evidence/implementation/TP-003/verification.json`。
- 阶段说明：本记录描述 TP-003 刚完成时的状态；TP-007/TP-008 后续完成后，最终 claims 将 AC-001/003/005/006 聚合为 PASS。

### TP-004（已完成）

- 完成日期：2026-09-30。
- 产出：纯 tokenizer 与版本号、FTS5 读写仓储、启动前索引校验/重建、范围/状态/有效期过滤、中文双字与技术标识符召回、覆盖率门槛、稳定排序；Memory 写入/更新/删除/归属与 token 投影共事务；删除回答路径 `LIKE` 和 `findAll` fallback。
- 验证：Unicode/中文/停用词/FTS quote/coverage/单字 query/ranking unit tests；integration 覆盖全局/空间隔离、归档空间、过期/未来事实、legacy 未归属不入 FTS、版本重建、事实更新索引同步与写失败回滚。测试结果记录在 `evidence/implementation/TP-004/verification.json`。
- 限制：无词面重合的同义问题明确 abstain；AC-003/004/005 仍需结合用户入口和最终入口 Harness 审核。

### TP-005（已完成）

- 完成日期：2026-09-30。
- 产出：全局四键 core 白名单、用户消息词面佐证、高置信度/主体/类型约束、user policy 优先、空间显式单值遮蔽、整体 XML 转义、完整事实确定性打包、最终包装 token 估算、核心/总预算和内容无关观察值；仅更新实际入选访问计数。
- 验证：core whitelist positive/negative，用户手动设置保持、零预算、oversize core skip、XML closing tag、整体有效预算、scope override、精选访问统计均有 unit/integration 覆盖。
- 限制：inputBudget 使用 Server 现有估算口径 95,904，context provider 根据 system/history/Wiki 贡献计算剩余值；不代表所有供应商实际窗口或账单 token 已确认。AC-002/012 仍等待最终入口与诊断证据。

### TP-006（已完成）

- 完成日期：2026-09-30。
- 产出：会话绑定以 revision 快照冻结到消息；ContextProvider 普通/ReAct 共用预算与一次性记忆块；worker transcript 按 scope/revision 隔离；memory disabled 在读取/召回/门控/提取前短路；活跃 run 作用域切换锁、停机拒绝新任务、abort/drain 与 SQLite close 顺序落地。
- 验证：最终 Harness 的 `memory-entry`、`memory-lifecycle`、全量 server regression 均通过；覆盖 ordinary/ReAct、SSE 顺序、重复注入、关闭开关、DB-close 后无写入。真实 CLI/REPL 与 Electron 进程结果见 TP-008。
- 证据：`.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-54-56-888Z-49204/`。

### TP-007（已完成）

- 完成日期：2026-09-30。
- 产出：声明式 memory/memory-spaces/conversation-scope endpoints；同步 client API、preload、ElectronAPI 与生成 manifest；Settings 记忆管理、旧记忆批量归属、core 控制及 chat scope selector。`memories:list` 接收完整 query 对象，避免 optional 参数压缩错位；管理列表默认排除未归属事实，仅在用户显式查看时包含。
- 验证：endpoint、memory-space service 与 HTTP/IPC 定义测试；四个浏览器 AC 场景通过：`browser-memory-policy-roundtrip`、`browser-legacy-assignment`、`browser-space-create-bind-unbind`、`browser-disabled-management`。全量 client regression 通过。
- 证据：最终 Harness `browser-ac.log`、browser tracing/network/screenshots 与 `memory-integration.log`，位于上述 run 目录。

### TP-008（已完成）

- 完成日期：2026-09-30。
- 产出：30 固定标注案例、10,000 条隔离 SQLite 基准、CLI chat/REPL 进程 smoke、Electron bundle 记忆 CRUD/召回/关闭 smoke、完整 Harness checks。
- 质量观察：26 个词法可回答案例 Recall@8=1.0；无关注入率=0；跨空间误取=0。24+8 基线 Recall@8=0.9615、无关注入率=0.9665。10k fixture 热查询 p50=1.057ms、p95=1.453ms，冷索引重建 199.509ms；环境 Node 20.19.4、SQLite 3.51.3、Apple M1 Pro。数据详见 `evidence/implementation/TP-008/quality-report.json`。
- 进程观察：CLI chat 和 REPL 各召回 1 条；重启后访问计数为 2、持久化用户消息为 2、真实模型调用为 0。Electron 真实 Node bundle 创建/绑定空间并召回 1 条，HTTP 200，shutdown 后 HTTP 请求被拒绝。均使用隔离临时数据库。
- 修复并验证：覆盖率阶段 endpoint HTTP fixture 使用 `127.0.0.1`，避免 localhost 代理/协议解析不稳定；endpoint 集成 33/33 通过，全量 coverage 随最终 Harness 通过。

### TP-009（已完成）

- 完成日期：2026-09-30。
- 产出：逐 AC 聚合结果、规格/设计/计划/追溯与索引同步，偏差和证据限制见 `verify-consistency.md`、`check-doc.md`。
- 最终验证：Harness `status=completed`、`claimStatus=PASS`；AC-001～AC-013 全部 PASS；server/client regression、memory-unit/integration/entry/lifecycle/quality/process、browser-ac、static、boundary、coverage、electron-smoke 全部通过。
- 审计边界：未执行独立第三方审阅；本次自审只核对 Harness 聚合、源码/测试和证据工件，不把主代理自审称作独立审计。真实 LLM/provider 质量、同义无词面召回与跨硬件性能不在本期证据范围。

| TP     | 状态   | 实际产出                             | 最终验证                                                                   | 问题/边界                               |
| ------ | ------ | ------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| TP-001 | 已完成 | Memory 边界检查与引用基线            | 最终 boundary、static、entry 与 Harness checks 全通过                      | GitNexus CLI 本轮超时，未冒充最新图结果 |
| TP-002 | 已完成 | Memory domain/infrastructure 拆分    | 全量回归、边界、typecheck/build/bundles 全通过                             | 上位 Server 其他领域未迁移              |
| TP-003 | 已完成 | schema、空间、revision/job/snapshot  | memory-integration、全量 server regression 通过                            | legacy 事实保持未归属，需用户显式归属   |
| TP-004 | 已完成 | FTS5 中文词法召回与事务索引          | memory-unit/integration、质量报告通过                                      | 无词面重合的同义语义不承诺              |
| TP-005 | 已完成 | core/预算/打包/诊断                  | memory-unit/entry/integration 与 AC-002/012 PASS                           | token 估算依赖项目估算器                |
| TP-006 | 已完成 | scope 快照、上下文与 worker 生命周期 | entry/lifecycle/process/electron probes 与 AC-002/003/006/007/008/011 PASS | 未运行真实模型                          |
| TP-007 | 已完成 | 声明端点、HTTP/IPC、设置与会话 UI    | memory-integration、四个 browser 场景、AC-001/007/009 PASS                 | browser API 使用完整隔离 mock           |
| TP-008 | 已完成 | 固定质量基准和实际入口 smoke         | process/electron/quality/static/coverage 全通过                            | 只证明本机 fixture/入口行为             |
| TP-009 | 已完成 | AC 证据聚合、审计与文档同步          | 最终 Harness claims 13/13 PASS、文档检查与格式检查通过                     | 独立第三方审阅未执行，审计能力降级      |

后续：本 change 的 TP 与产品 AC 已完成；上位 `2026-09-29-server-structure` 仅 Memory 专项获得本变更实现证据，不更新其余 TP 状态。

### TP-007/TP-008 后续修复（2026-10-01）

- 用户反馈真实界面的“待归属”列表为空后，检查获准的当前用户数据库，发现 121 条 active/unassigned 记忆；数据库 migration #32 已完成。
- 根因：无名 query mapping 未透传 Express `req.query`，client Manifest 也未序列化整个 query object。已修复 Express、Web URL builder、Electron IPC/preload，并新增 helper、client URL 与真实 HTTP route 回归。
- 验证：memory API + endpoint helper 103 tests passed、client API 5 tests passed、typecheck 通过；经 Vite `/api` 代理只读 GET 得到 HTTP 200，待归属 84 条、全局 37 条。
- 数据处理：先创建 `~/.mint/data.db.pre-memory-repair-20261001` 备份；通过正式批量归属 endpoint 将无冲突 37 条归入 global。84 条属于 7 个不同内容的同键冲突组，仍待用户决定冲突处理策略；没有自动 supersede 或覆盖它们。元数据报告见 `evidence/implementation/TP-008/live-history-repair.json`。
- 未解决：冲突组如何消解是数据策略决定。旧记忆归属修复不等同于 AC 失败；所有历史数据均可在“待归属”列表查看，未归属事实仍不会注入回答。

### 2026-09-30：Harness run 2026-09-30T15-05-05-692Z-85468

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-05-05-692Z-85468
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-05-29-439Z-85768

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-05-29-439Z-85768
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-07-43-246Z-90097

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-07-43-246Z-90097
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-14-44-925Z-2824

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-14-44-925Z-2824
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-20-40-434Z-11038

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-20-40-434Z-11038
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:failed, claims:FAIL

### 2026-09-30：Harness run 2026-09-30T15-33-30-351Z-30730

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-33-30-351Z-30730
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:failed, claims:FAIL

### 2026-09-30：Harness run 2026-09-30T15-34-40-311Z-31906

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-34-40-311Z-31906
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-41-43-944Z-37804

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-41-43-944Z-37804
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:passed, electron-smoke:passed, claims:PASS

### 2026-09-30：Harness run 2026-09-30T15-54-56-888Z-49204

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-54-56-888Z-49204
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:passed, electron-smoke:passed, claims:PASS

### 2026-10-01：Harness run 2026-10-01T03-17-15-559Z-38895

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-10-01T03-17-15-559Z-38895
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:failed, claims:FAIL

### 2026-10-01：Harness run 2026-10-01T03-18-43-494Z-40308

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-10-01T03-18-43-494Z-40308
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:passed, electron-smoke:passed, claims:PASS

### 2026-10-01：query-object 修复后的完整 Harness run 2026-10-01T03-18-43-494Z-40308

- 状态：completed；全部 13 个 claims PASS。
- 产出：unnamed query object 经 Express、client manifest 与 Electron IPC 完整透传；HTTP integration 验证待归属筛选。
- 检查：server/client regression、memory unit/integration/entry/lifecycle/quality/process、browser-ac、static、boundary、coverage、electron-smoke 全部 passed。
- live 数据：37 条无冲突旧记忆经 scope-assignment endpoint 归 global；84 条/7 个冲突组保留为 unassigned，等待用户决定冲突策略。修复前快照和计数见 `evidence/implementation/TP-008/live-history-repair.json`。
