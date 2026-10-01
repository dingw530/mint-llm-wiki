# 源码评估与参考边界

## 快照与范围

- 日期：2026-09-30（Asia/Shanghai）。
- Mint：`/Users/wangding/WorkSpace/personal/ai-chat`，HEAD `2fe23f45137cffdbcc229de3763001154d210207`。
- agentmemory：`/Users/wangding/WorkSpace/open-source/agentmemory`，HEAD `ab3e4efd282659b87d31b36c8514c6bc6b871f0b`。
- 已有工作区改动：未跟踪 `docs/mint-project-interview-qa.md`，本次保留。
- 评估方式：本地源码与提案检查、GitNexus；未启动 agentmemory 服务，未运行 Mint 产品测试、真实模型/embedding 请求或用户 DB migration。

## Mint 当前事实

| 位置                                                                | 当前实现                                                                | 本期改造理由                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| server/services/api/memoryService.ts：buildMemoryContext            | 24 active semantic + 8 LIKE 结果，ID 去重、全文按六分类输出             | 类型与常驻策略混在一起，无独立 token 预算                |
| server/repositories/memoryRepository.ts：search / findActiveProfile | 空白切词、AND LIKE；只筛 active；画像按 importance/updatedAt            | 中文整句弱，无 scope/有效期条件                          |
| server/services/contextProviders/memoryContextProvider.ts           | memoryEnabled 控制，动态 user_memory 放最新 user 前，声明为参考数据     | 保留 placement 和优先级，扩展预算/快照接口               |
| server/services/contextProvider.ts / messageService.ts              | 同步 collect/apply；sendMessage 统一入口；SSE 完成后异步门控入队        | 新检索和压缩需显式贡献快照，覆盖普通/ReAct/CLI           |
| server/services/utils/contextWindow.ts / tokenEstimator.ts          | ReAct 使用固定上下文输入预算，字符/3 粗估；按 user 单元压缩             | 独立插入的记忆可能进入旧摘要；不能将估算当作模型精确窗口 |
| server/services/api/memoryService.ts / memoryJobService.ts          | 结构化解析、事务事件、消息 through 快照；worker 生命周期显式 start/stop | 继续保留；补空间 revision 和跨绑定轨迹隔离               |
| server/repositories/memoryJobRepository.ts                          | conversation_id 唯一任务行、新消息 pending 重排、有限重试               | 切换作用域后需要复合身份，不能覆盖旧空间待执行快照       |
| server/types.ts / conversations repository/endpoints                | 会话有 Agent/routing 字段，没有工作区/知识空间 ID                       | 新契约必须明确为拟新增；不假定已有 scope 基础设施        |
| server/endpoints/definitions/memories.ts / MemoriesPanel.tsx        | CRUD 只处理正文/分类，管理页无常驻/归属控件                             | 需要端点与用户控制一起交付                               |
| server/architecture/**tests**/boundary.test.ts                      | 按旧顶层层级和已知违规约束                                              | 新 domains/infrastructure 未自动纳入，必须补规则防止漏检 |

## agentmemory 可借鉴与不可直接套用的部分

| 本地源码                                                                                                   | 观察                                                                                                | Mint 决策                                                                           |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [working-memory.ts](/Users/wangding/WorkSpace/open-source/agentmemory/src/functions/working-memory.ts:100) | core 独立存储、30% 预算、重要性/访问/时效评分；pinned 可越过 coreBudget；归档按 strength/时间填预算 | 采用分层/预算，取消固定项越限，不依赖访问数自动晋升                                 |
| [slots.ts](/Users/wangding/WorkSpace/open-source/agentmemory/src/functions/slots.ts:170)                   | global/project KV 中按 label 合并，project 同名覆盖 global；接口本身无明确 projectId 参数           | 采用显式控制理念；Mint 使用具体 spaceId 的 DB 过滤，不能声称 slots 已证明多空间隔离 |
| [context.ts](/Users/wangding/WorkSpace/open-source/agentmemory/src/functions/context.ts:77)                | pinned/profile/lessons 与项目会话摘要、观察块；近期项目会话最多 10 条                               | 不每轮附带全部类别；本期 core+相关事实足够                                          |
| [context.ts](/Users/wangding/WorkSpace/open-source/agentmemory/src/functions/context.ts:276)               | 按 recency 排块，包装计 token，超预算整块跳过，部分访问记录                                         | 最终预算复算与诊断可借鉴；选取改成单条事实和问题相关性                              |
| [search.ts](/Users/wangding/WorkSpace/open-source/agentmemory/src/functions/search.ts:614)                 | query/project/cwd/format/token_budget，BM25 与有向量时的混合路径                                    | 读取接口显式范围/预算；先本地词法，后续两段式工具/向量                              |
| [search.ts](/Users/wangding/WorkSpace/open-source/agentmemory/src/functions/search.ts:852)                 | compact/narrative/full 响应，预算打包；访问登记在预算截取前；成功日志记录 query                     | 不将候选访问等同于实际入选；普通日志不记 query/正文                                 |
| [README.md](/Users/wangding/WorkSpace/open-source/agentmemory/README.md:1010)                              | 三路检索与 CJK 可选分词说明                                                                         | 中文需要明确实现与 fixture，不能只换 BM25 就宣称中文好用                            |

其自动 context 与独立 query search 的入口不同；working-context 仍会将部分归档事实按 strength/time 装入，不能描述为完全按当前问题自动语义召回。README 的 Recall@5、节省 token 数字本次未复跑；不外推到 Mint。

## Server 结构对齐

读取了 [上位设计](../2026-09-29-server-structure/design-doc.md)、[执行计划](../2026-09-29-server-structure/exec-plan.md) 和 [追溯](../2026-09-29-server-structure/traceability.md)。它们仍是提案，尚无整体目录迁移。

采用单包、domains/memory、专属 infrastructure、显式 bootstrap 装配与公共接口。先完成 Memory 的依赖边界和行为保持拆分，之后增加记忆行为；不把本期视为 app/ServerRuntime/reactLoopCore 的整体迁移。目标映射、兼容 facade 退出条件和构建/入口证据写在设计与 TP 中。

## GitNexus 当前证据与限制

1. 默认 wrapper 会尝试 npm 网络获取，因此使用已缓存 CLI 1.6.12 的本地路径运行，绑定 repo=mint-ai-chat。agentmemory 未注册 GitNexus 索引，以实际源码为证据。
2. 首次 analyze --index-only 写用户注册锁遭 sandbox EPERM，之后授权扩大执行范围仅刷新本地索引/注册元数据；为恢复中断标志执行全量重建，最终 exit 0。没有改 tracked Server 源码或 AGENTS。
3. 当前重建结果：15,961 nodes、30,174 edges、310 clusters、748 flows。流程生成告警：1,073 个候选入口未入选，1,347 个 callee 被分支上限省略，76 个 walk 被预算截断；跨语言属性解析另有 272 个不可连接位置。
4. 原始 impact/query JSON 保存于 [evidence/gitnexus/](evidence/gitnexus/)，用于当前设计风险识别，不作为完整调用清单或实施验收。

| 目标                    | 图判定 / 数量                                                                                                                                     | 可见调用/流程                                                               | 解释                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| applyContextProviders   | HIGH；5 impacted；1 direct；3 affected processes                                                                                                  | sendMessage → CLI handleChat/runRepl；sendMessage 流程                      | 高风险入口接缝，需单独回归与实际进程证据                                          |
| buildMemoryContext      | UNKNOWN；0 resolved callers                                                                                                                       | 文本确认 provider 的 default 参数别名 → applyContextProviders → sendMessage | 零不是无人使用；无法用 LOW 结论推进                                               |
| enqueueMemoryProcessing | LOW；3 impacted；1 direct                                                                                                                         | runMemoryGate → scheduleMemoryExtraction → sendMessage                      | 图可见面有限，任务/空间/关闭设计仍按高风险验收                                    |
| performExtraction       | LOW；4 impacted；1 direct                                                                                                                         | drain → scheduleDrain → enqueue/start                                       | 事务/外部调用/关闭不能仅靠图评分证明安全                                          |
| ServerRuntime           | LOW；10 impacted；2 direct                                                                                                                        | createRuntime、server/index；已知 CLI/Electron 消费                         | 与上位旧快照的 CRITICAL 不同；方向/解析/采样限制不取消其生命周期关键性            |
| sendMessage             | 首次同名查询 ambiguous；后以 Function:server/services/messageService.ts:sendMessage 精确 UID 查到 LOW、6 impacted、3 direct、2 affected processes | messages route、handleChat、runRepl                                         | 当前精确结果保存为 impact-sendMessage-exact.json；不从 ambiguous 候选推导安全结论 |

补充源码引用：CLI commands/chat.ts 与 repl.ts 调用 messageService.sendMessage；ServerRuntime 导入并 start/stop 记忆 worker；memoryContextProvider 用别名调用 buildMemoryContext。该盘点用于补图盲区，不能替代 graph-first 分析。

## 本次验证界限

只验证方案结构、引用/契约和 Harness 可消费性，结果记录在 check-doc.md。未修改生产/测试代码，没有运行本期产品 AC 测试、构建、浏览器或真实模型效果评估；不能引用历史 P0/Harness PASS 作为新改造 PASS。
