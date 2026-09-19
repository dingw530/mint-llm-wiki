# Mint 技术债务与产品规划债务待办

更新时间：2026-09-03
适用分支：`develop`
评估原则：区分已验证事实、基于代码的风险判断，以及仍需产品决策的事项。

## 结论先行

Mint 已经不是概念验证：桌面端、HTTP 服务、流式对话、Agent、MCP、记忆和 LLM Wiki 均有实际实现，工程测试与自动化评测也已建立。当前最大的风险不是“功能太少”，而是：

1. 部分高风险运行时边界仍依赖单用户桌面应用的前提，HTTP/Docker 形态一旦被当作服务部署，安全模型不成立。
2. Agent 的评测已经能发现问题，但当前评测快照仍出现伪引用和未拒答，且 token、成本、TTFT 没有有效数据，质量和成本决策缺少可靠观测。
3. 产品能力很多，但核心价值链“采集知识 → 编译 Wiki → 检索 → 有证据地回答 → 用户修正”还缺少明确的目标用户、成功指标和取舍规则。
4. 首次使用路径没有把“连接模型 → 完成首个任务 → 理解 Wiki 价值”编排出来；用户可能在第一次发送消息时才遇到配置错误，或完成普通聊天后仍不了解 Mint 的差异化价值。

因此，后续优先级应是先建立可信的安全、质量、首次使用和产品闭环，再扩展知识图谱、A2UI、图片生成等外围能力。

## 现状快照

以下数字是当前仓库已有的最近一次验证快照；除评测 JSON 外，本次没有重新执行全量测试，因此执行具体债务前应刷新证据。

| 维度          |                                                   快照 | 客观含义                                                 |
| ------------- | -----------------------------------------------------: | -------------------------------------------------------- |
| Server 测试   |                                             763 passed | 后端已有较完整回归基础，但通过不等于高风险边界已充分覆盖 |
| Client 测试   |                                              69 passed | UI 基础测试存在，仍需结合关键用户流程验收                |
| Agent-eval    |                             53 passed，另有 16 skipped | 评测资产已形成，但覆盖范围和跳过原因需要持续治理         |
| Server 覆盖率 | 82.23% statements / 77.17% branches / 80.68% functions | 整体可接受；分支和关键工具链的风险不能用平均值掩盖       |
| Wiki RAG 评测 |            25 个用例、每题 1 次运行，22/25 通过（88%） | 可作为发现问题的基线，不能作为稳定性结论                 |
| 评测延迟      |                                 平均 7.57s，p95 10.48s | 交互等待偏长，需先拆分 TTFT 与完整响应耗时               |
| 评测观测      |                             token / cost / TTFT 均为 0 | 当前不能据此做模型、成本或体验优化决策                   |
| 构建产物      |               存在客户端大 chunk 警告，主入口约 657 kB | 首屏和缓存效率有优化空间                                 |

评测失败样例包括：答案引用不存在的 `C8/C10`，以及无答案场景未拒答。证据来源为 `agent-eval/viewer/report.json`，生成时间为 `2026-08-31T12:22:31.512Z`。

## 一、技术债务

状态约定：`待开始`、`进行中`、`待验证`、`已完成`、`明确接受`。本表新增事项默认均为 `待开始`。

TD-001～TD-015 为 2026-09-01 前登记；TD-016 起为 2026-09-02 技术架构评审新增，基于源码通读与三份并行审计（server 分层 / client 架构 / 工程与文档卫生），证据路径见文末“2026-09-02 架构评审证据”。

### P0：影响安全、数据正确性或评测可信度

| ID     | 类型                  | 待办                                                                                                                                                                                                                                               | 完成标准                                                                                                                                                                                                               | 状态                                                                             |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TD-001 | 已验证事实 + 风险判断 | 已实施方案 A：默认 Node/Electron 仅 loopback；Docker 容器内可监听 `0.0.0.0`，但官方宿主机发布固定为 `127.0.0.1`。真实 Docker 守护进程网络 smoke 尚未可运行，不能宣称部署边界已经完成验证。                                                         | 默认仅允许 localhost；若支持局域网/公网，增加认证、授权、会话/密钥管理、审计和部署文档，并有未授权访问测试。对应 SDD：[本机 HTTP 与 Docker 暴露边界](changes/2026-09-04-localhost-exposure-boundary/traceability.md)。 | 待验证                                                                           |
| TD-002 | 已验证代码风险        | SQLite 迁移对非幂等错误只打印错误并继续，可能造成数据库处于“迁移记录与实际 schema 不一致”的状态。                                                                                                                                                  | 非幂等迁移失败时 fail-closed：停止启动或进入明确故障态；幂等兼容逻辑有独立测试和日志。对应 SDD：[SQLite 迁移失败关闭](changes/2026-09-06-migration-fail-closed/traceability.md)。                                      | 已完成                                                                           |
| TD-003 | 安全测试缺口          | 完善 `http_fetch` 的 DNS rebinding、解析结果变化、重定向到私网/本机、IPv6 和代理场景测试。当前策略已拦截部分字面私有地址，但不足以证明请求最终目的地安全。                                                                                         | 每次连接和重定向均执行目标地址策略；覆盖 IPv4、IPv6、DNS 变化和重定向测试；拒绝结果可观测。                                                                                                                            | 已完成（见 [SDD](changes/2026-09-06-http-fetch-ssrf-hardening/traceability.md)） |
| TD-004 | 边界风险              | 明确 macOS sandbox、host fallback 以及 Windows/Linux fallback 的安全承诺。当前 Bash 对高风险命令禁用 host fallback，但跨平台隔离能力和失败行为需要形成契约。                                                                                       | 按平台列出真实隔离边界、允许目录、审批行为和降级行为；高风险命令无静默宿主机执行；有平台级验证记录。                                                                                                                   | 待开始                                                                           |
| TD-005 | 已验证评测失败        | 修复引用生成/校验链，禁止答案引用检索结果之外的 `C8/C10` 等不存在证据；补齐无答案场景的 abstention。                                                                                                                                               | 评测中不存在伪引用；无支持证据时稳定拒答或明确不确定；deterministic gate 与 judge 结果一致。                                                                                                                           | 待开始                                                                           |
| TD-016 | 已验证代码风险        | 修复 `reactMaxIterations=0` 仍会执行工具的语义陷阱：路由在“无工具或 `reactMaxIterations===0`”时降级到 `aiProxy.ts` 的单轮工具路径（`streamChat`），该路径仍会执行工具，与“已关闭工具”的配置意图冲突；遗留路径与 `reactLoopCore` 形成两套聊天引擎。 | `reactMaxIterations=0` 时确定不执行工具并有差异测试断言；单轮工具路径移出 `aiProxy.ts` 或收敛进 `reactLoopCore`；两引擎对同一输入行为一致且有回归测试。                                                                | 待开始                                                                           |

### P1：影响长期稳定性、诊断效率和迭代成本

| ID     | 类型             | 待办                                                                                                                                                                                                                                                                         | 完成标准                                                                                                                                     | 状态   |
| ------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| TD-006 | 能力缺口         | 完成 AgentRun 中断后的用户恢复流程。当前可以持久化和恢复状态，但还缺少产品级的继续、重试、放弃、未知工具结果处理和副作用确认闭环。                                                                                                                                           | 用户能看到运行状态并选择继续/重试/放弃；工具副作用有明确确认语义；重启和重复操作有幂等策略。对应 SDD：[AgentRun 可恢复持久化](changes/2026-09-18-agent-run-recoverable-persistence/traceability.md)。 | 已完成 |
| TD-007 | 已验证观测缺口   | 补齐 token、成本、TTFT、模型、Provider、重试、失败原因和运行环境记录，并区分流式首字节时间与完整响应时间。                                                                                                                                                                   | 线上运行和评测均能产生非零、可校验的指标；指标口径、隐私边界和聚合方式有文档与测试。                                                         | 待开始 |
| TD-008 | 覆盖率结构性缺口 | 对 MCP、sandbox、ToolRegistry、WikiSearchTool、错误恢复和跨 transport 路径增加定向测试。                                                                                                                                                                                     | 高风险模块有分支覆盖目标；HTTP、IPC、SSE 的关键契约均有回归测试；失败场景不只依赖集成测试。                                                  | 待开始 |
| TD-009 | 测试隔离噪声     | 清理迁移初始化过程中反复出现的 `stderr`，区分测试隔离导致的预期噪声与真正的生产迁移失败。                                                                                                                                                                                    | 测试输出能明确标记“预期隔离噪声”；真实迁移失败会使测试失败并保留可诊断上下文。                                                               | 待开始 |
| TD-010 | 可维护性         | 拆分职责混杂、规模过大的服务/组件文件，优先处理 400～800 行且同时包含编排、持久化和 transport 逻辑的文件。                                                                                                                                                                   | 每次只围绕一个职责边界拆分；行为不变；有调用链影响分析、回归测试和可读性检查。                                                               | 待开始 |
| TD-011 | 性能             | 优化客户端 bundle 分包和懒加载，重点关注知识图谱、设置、图片和非首屏能力。                                                                                                                                                                                                   | 首屏入口体积、gzip/brotli 体积和加载时间有基线；非首屏模块不进入主入口；构建警告消除或有明确例外。                                           | 待开始 |
| TD-012 | 供应链治理       | 将“手动更新依赖”升级为可执行的依赖升级、漏洞响应和 Electron/native ABI 验证策略。                                                                                                                                                                                            | 有固定检查周期、升级负责人/记录、锁文件审查和 better-sqlite3/sqlite-vec/Electron 打包验证。                                                  | 待开始 |
| TD-017 | 已验证代码事实   | AgentRun 恢复链路“写而未接”：`agentRunRecoveryService.ts` 有实现与测试但生产零引用；每轮事件虽持久化到 `agent_run_events`（`agentRun.ts`），却无恢复入口；工具审批仅存进程内 `approvalStore.ts`（10 分钟 TTL），重启后 `paused_for_approval` 的 run 不可恢复。               | 接线或删除二选一并记录决策：若接线，重启后能依据事件流恢复暂停/中断 run；若删除，同步移除相关建表与事件持久化，避免“假可靠性”。              | 待开始 |
| TD-018 | 已验证漂移       | 跨层 DTO 无共享类型源：`server/types.ts`、`client/src/types/index.ts`、`electron/preload.js` 三处手写并已漂移——client `Message` 已含 server 未知的 `segments`/`_tempId` 等字段；`UploadJob` 在 types 与 `wiki.ts` 声明两遍；`ElectronAPI` 与 wiki API 模块存在循环类型引用。 | 收敛到单一来源（共享类型包，或由 endpoints manifest/schema 生成 DTO）；消除重复声明与循环引用；漂移在 CI 类型检查中被捕获。                  | 待开始 |
| TD-019 | 已验证代码风险   | 客户端端点契约双写与传输“方言”三分：`conversations.ts` 完全绕过生成的 endpoints manifest，手写 `ipcOrHttp`/`request`；`wiki.ts` 混用 manifest、双通道与裸 fetch；`images.ts` 无 IPC 通道。manifest 未被打包进 bundle 时 `_base.ts` 静默抛 `Unknown endpoint`，无构建期报错。 | 客户端 API 模块统一走 manifest/`callEndpoint`；manifest 缺失在构建/启动期 fail-fast；消除同一端点契约的双写。                                | 待开始 |
| TD-020 | 可维护性         | 消息模型双真相 + chat↔images 耦合：流式 `segments` 与持久化 `uiBlocks` 两套来源（MessageList 在 segments 为空时重推导），`reasoning` 双写；`MessageList.tsx`（约 500 行）同时渲染消息与整条图片管线，`images` feature 靠复用其内部组件耦合。                                 | 单一渲染模型（存储一份、派生另一份并明确方向）；`reasoning` 只落一处；图片渲染从 MessageList 拆出，消除 images→chat 内部组件依赖。           | 待开始 |
| TD-021 | 已验证代码风险   | schema 双源真相：`db.ts` 的 `createSchema()` 持有全量建表，增量变更写进 `migrations/index.ts` 单文件内联数组（29+ 步），两者靠人肉同步；新增列必须同时改两处，全新库与逐级迁移后的结构存在静默分叉风险。                                                                     | 新结构变更只改一处：让迁移成为唯一事实源并校验 `createSchema` 一致，或从单一 schema 定义生成两者；有测试断言“全新库”与“逐级迁移库”结构一致。 | 待开始 |

### P2：文档、工具和治理债务

| ID     | 类型           | 待办                                                                                                                                                                                                                                                                       | 完成标准                                                                                                           | 状态   |
| ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| TD-013 | 已验证缺陷     | 修复 `agent-eval/viewer/versions/index.json` 为空对象导致的版本发现/切换不可靠问题。                                                                                                                                                                                       | 版本索引由真实版本生成；Viewer 可列出、打开并对比版本；缺失或损坏索引有降级提示。                                  | 待开始 |
| TD-014 | 已验证漂移     | 同步 README 与实际依赖版本。README 仍显示 Electron 33、TypeScript 5，而当前 package 配置为 Electron 41.7.1、TypeScript 6.0.3。                                                                                                                                             | README、构建检查和发布说明中的版本来源一致，升级后不会只改其中一处。                                               | 待开始 |
| TD-015 | 已验证治理问题 | 清理 SDD 索引中长期停留在“草稿、规划中、执行中、待启动”的陈旧状态，区分真正未完成和历史遗留文档。                                                                                                                                                                          | 每条变更都有负责人/下一步/阻塞原因，已完成或废弃项从活动列表中清理，索引与实际状态一致。                           | 待开始 |
| TD-022 | 可维护性       | 异步任务四套调度并存：memory（`memoryJobService` 自研 setImmediate 单飞）、wiki ingestion（`jobs/` JobQueue+JobStore）、wiki lifecycle（`setInterval` 6h）、vector backfill（裸 setTimeout）；事务性 SQL claim 逻辑两处重复（`sqliteJobStore` vs `memoryJobRepository`）。 | 收敛到统一队列/调度原语；claim+recover 单一实现并有并发/崩溃恢复测试。                                             | 待开始 |
| TD-023 | 已验证代码风险 | 层边界零星泄漏：部分 routes/endpoints 直连 repository 做 CRUD（`routes/messages.ts` 图片生成等分支绕过 service 层）；repositories 存在 type-only 反向 import（`a2uiRepository`、`wikiSearchRepository`）；`sqliteJobStore` 越过 repositories 手写 SQL。                    | 现有边界回归测试（`architecture/__tests__/boundary.test.ts`）覆盖上述路径；越界处收敛到 service 层或登记显式豁免。 | 待开始 |
| TD-024 | 已验证代码风险 | 加密密钥治理：`scrypt` 使用固定盐 `ai-chat-salt`、无密钥轮换；`encrypt`/`decrypt` 在运行时缺 key 时 `process.exit(1)`（`encryption.ts`），工具函数会直接杀进程。                                                                                                           | 盐随机化/参数化并支持存量密文迁移；定义密钥轮换流程；加密工具改为抛错而非进程退出。                                | 待开始 |
| TD-025 | 已验证治理问题 | 工具链“半开”：`lint-staged` 已配置但无任何 hook 调用；prettier 不进 CI（仅手动 server 检查）；electron 0 测试且不在 lint/CI 覆盖；`agent-eval`/`website`/`.harness` 与 `.mjs` 脚本未被 eslint 覆盖。                                                                       | 删除或真正接线 lint-staged；CI 增加 prettier check；electron 建立最小冒烟测试；补齐 lint 覆盖范围。                | 待开始 |
| TD-026 | 已验证治理问题 | 根目录调试产物反复入库：`output.png`、`harness-failure.png`、`harness-failure.yaml` 已被提交且多次随 “update failure artifacts” 提交更新；`.gitignore` 仅豁免 `architecture.png`。                                                                                         | 将上述文件移出版本库并加入 `.gitignore`；harness 截图/快照输出改到 gitignored 目录（如 logs/）。                   | 待开始 |
| TD-027 | 已验证漂移     | 类型版本与运行时错位：`@types/react` 19 ↔ `react` 18、`@types/express` 5 ↔ `express` 4，类型层比运行时新一大版，削弱类型守卫效果。                                                                                                                                         | 类型包 major 对齐运行时（升级运行时或降级类型）；纳入 TD-012 依赖治理的同一检查周期。                              | 待开始 |
| TD-028 | 已验证漂移     | AGENTS/CLAUDE 与 ARCHITECTURE 关键指针失效：指向不存在的 `orchestratorService.ts`/`reactRoundEngine.ts`/`server/src`；架构文档写“三个包”而实际 5 个 npm workspace（外加无 workspace 的 `java-server` 残留）；`docs/test-plan.md` 被引用但从未创建。                        | 校对文档指向真实符号与目录、删除失效指针；架构文档同步真实包结构；补建或移除 test-plan.md 引用。                   | 待开始 |
| TD-029 | 已验证治理问题 | `java-server/` 尸体目录：无任何源码提交（仅 `.gitignore` + `target/` 构建产物），对应 change doc 自评“核心实现完成，保留未验证风险”，无法回归、无人知晓其状态。                                                                                                            | 明确终止并清理目录与索引、登记为已终止实验；或补全源码纳入验证与构建。                                             | 待开始 |
| TD-030 | 已验证架构风险 | 启动与关闭生命周期分散在 `app.ts`、`index.ts`、CLI、Docker 和 Electron 入口；`app.ts`/服务模块存在 import-time 启动副作用，CLI 存在重复启动风险，Memory、Wiki queue、MCP、SSE、Langfuse 和 SQLite 没有统一资源所有权与关闭顺序。 | 引入 `createApp` + `ServerRuntime`；消除 import 副作用；统一 Node/CLI/Docker/Electron 启动入口；为后台 worker、queue、timer、SSE、MCP、Langfuse、SQLite 建立幂等且有超时的 shutdown；完成信号、Docker 和 Electron smoke 验证。详见 [启动与关闭生命周期整改方案](architecture/server-lifecycle-remediation.md)。 | 待开始 |

## 二、产品功能规划债务

这里的“债务”不是“再增加几个功能”，而是已有能力缺少目标、边界、成功标准或用户闭环。没有先解决这些问题，继续扩展功能会放大维护成本和产品分散度。

### P0：必须先做出的产品判断

| ID     | 待决策/待办                                                                                                                                                                             | 需要产出                                                                                                                                                   | 状态   | 完成日期   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| PP-001 | 明确目标用户和首要场景。当前产品同时覆盖个人知识管理、Agent、MCP、自动化和图谱，主用户画像与优先场景还不够收敛。                                                                        | 一页产品定位：目标用户、非目标用户、前三个高频任务、明确不做的场景。                                                                                       | 待开始 |
| PP-002 | 定义核心闭环和北极星指标：知识采集 → Wiki 编译 → 检索 → 有证据回答 → 用户修正/复用。                                                                                                    | 每一环的激活、完成、质量和留存指标；至少有一个能反映用户获得价值而非功能调用次数的北极星指标。                                                             | 待开始 |
| PP-003 | 定义“可信回答”的产品标准。引用存在不代表引用正确，当前评测已暴露伪引用和无答案不拒答。                                                                                                  | 引用正确性、证据覆盖、冲突知识、低置信度、无结果拒答和用户纠错的统一 UX 与验收标准。                                                                       | 待开始 |
| PP-004 | 明确本地个人工具与多用户服务是否是两条产品路线。当前 AES 密钥存储、无认证和单用户模型适合桌面端，不自动适合团队服务。                                                                   | 路线决策：只做本地优先，或建立服务化路线；两者的隔离、账号、数据、部署和商业目标不能混在默认路径中。                                                       | 待开始 |
| PP-013 | 建立首次启动与模型连接引导。当前应用直接进入 Chat，首屏提示用户发送消息，但新安装时模型配置可能为空；用户发送后才会收到 `API URL or API Key not configured`，并且会先创建一个无效会话。 | 首次启动检测可用模型端点；无端点时展示连接模型 CTA、配置说明和稍后体验选项；未配置状态不再通过真实发送才暴露；失败后可直接回到修复路径，且不产生无效会话。 | 已完成 | 2026-09-02 |
| PP-014 | 统一首次使用的模型配置入口。当前同时存在“通用设置”的 API URL/API Key/Model ID 和“模型端点”的配置模型，用户无法判断应该从哪里开始。                                                      | 明确一个主入口（建议为“模型连接”）；首次流程只展示服务商、Key、模型和连接测试，高级端点/API 类型/多模型能力渐进展开。                                      | 已完成 | 2026-09-02 |

### P1：核心能力的产品完整性

| ID     | 待办                                                                                                                                                | 需要产出                                                                                                                                                          | 状态   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PP-005 | 规划 Wiki ingestion 的质量与生命周期。                                                                                                              | 去重、增量更新、版本、来源可信度、过期检测、删除传播、失败重试和人工审核的用户可见规则。                                                                          | 待开始 |
| PP-006 | 规划 AgentRun 中断后的完整用户体验。                                                                                                                | 继续、重试、放弃、查看未知工具结果、确认副作用、恢复后如何向用户解释状态变化。                                                                                    | 待开始 |
| PP-007 | 规划数据控制能力。                                                                                                                                  | 导出、备份、恢复、迁移、灾备和加密密钥轮换；明确用户能否在不依赖 Mint 的情况下拿回原始知识和对话。                                                                | 待开始 |
| PP-008 | 建立模型与成本策略。                                                                                                                                | 默认模型、Embedding 模型、Provider fallback、超时/重试策略、单次任务成本预算和用户可见的成本提示。                                                                | 待开始 |
| PP-009 | 建立评测代表性和稳定性标准。当前 Wiki RAG 只有 25 个用例且每题运行 1 次。                                                                           | 加入真实用户任务、长文档、过期知识、冲突知识、无答案和工具失败场景；关键集每题至少运行 3 次，分别记录质量、稳定性、延迟和成本。                                   | 待开始 |
| PP-015 | 设计能够体现 Mint 差异化价值的首个成功任务。当前空聊天页只展示“发送消息开始对话”，完成普通问答并不能让用户理解本地 Wiki、来源引用和知识沉淀的价值。 | 提供至少一个可跳过的示例任务；建议路径为“连接模型 → 导入一份文档 → 基于文档提问 → 查看带来源的回答 → 继续追问或打开 Wiki”；记录首个有效答案和首个 Wiki 价值事件。 | 待开始 |
| PP-016 | 将 Wiki 空状态改为可行动的首用入口。当前知识库为空时只显示“暂无文件”，配置路径又隐藏在设置中，用户无法自然完成第一次知识导入。                      | 空状态提供“选择知识库文件夹”“上传第一份文档”“使用示例知识库”等动作；Electron 优先支持文件夹选择；导入、摄入完成和首次提问之间有明确状态衔接。                     | 待开始 |
| PP-017 | 建立首次使用的失败恢复与体验指标。当前模型连接失败、Wiki 路径未配置和上传失败虽然有底层错误，但未形成统一的下一步操作；尚未定义首用完成标准。       | 统一错误分类、修复 CTA 和重试语义；定义并埋点首屏到首个有效答案时间、模型连接成功率、首次任务完成率、首用中断点和首个 Wiki 问答率；区分启发式目标与实际观测数据。 | 待开始 |

### P2：能力取舍与扩展规划

| ID     | 待办                                                              | 需要产出                                                                                                       | 状态   |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| PP-010 | 为知识图谱、A2UI、图片生成、MCP 主动发现等能力建立保留/延后标准。 | 每项能力的用户问题、使用频率、对核心闭环的贡献、维护成本和停止条件；没有明确价值时暂缓扩展。                   | 待开始 |
| PP-011 | 明确 Electron、Docker、未来 Web 形态的功能一致性边界。            | 能力矩阵：哪些能力必须一致，哪些只在桌面端提供，哪些需要服务端能力；避免“多端都能启动”被误认为“多端体验等价”。 | 待开始 |
| PP-012 | 建立用户反馈与功能淘汰机制。                                      | 每个迭代记录真实使用任务、失败原因、留存/复用信号和淘汰候选；把“已实现”与“被用户证明有价值”分开。              | 待开始 |

## 三、建议执行顺序

1. **安全与数据正确性**：TD-001～TD-004、TD-016 优先，先把 HTTP/工具边界、迁移失败边界与“关闭工具仍会执行”的语义陷阱锁死。
2. **架构一致性收敛（2026-09-02 评审新增核心）**：TD-017 先做“接线或删除恢复”决策；TD-018 收敛跨层类型到单一来源；TD-019 统一客户端传输与端点契约。
3. **评测可信度与观测**：TD-005、TD-007、TD-008、PP-003、PP-009，确保后续优化有可信反馈。
4. **首次使用闭环**：PP-013～PP-017，先打通模型连接、首个成功任务和 Wiki 价值展示，再评价后续功能留存。
5. **产品定位与核心闭环**：PP-001～PP-005，形成一份可验收的核心路线，再决定新增功能。
6. **可靠性与体验**：TD-006、TD-009～TD-012、TD-020～TD-024、TD-030、PP-006～PP-009。
7. **扩展与治理**：TD-013～TD-015、TD-025～TD-029、PP-010～PP-012，在前述基础上处理版本、文档、工具链和能力取舍。

## 四、更新规则

- 每个待办必须有唯一 ID、优先级、负责人、下一步、完成标准和验证证据。
- “已验证事实”应附源码、测试或报告路径；“风险判断”必须标注验证方式；“产品决策”不能伪装成技术结论。
- 完成标准满足前，不将状态改为“已完成”；代码已合并但未验证的事项使用“待验证”。
- 涉及产品用户流程的事项，应在 `docs/changes/<变更标识>/` 建立对应规格、设计和执行记录；本文件只负责债务总览，不替代具体变更文档。

## 主要证据索引

- 产品定位与当前能力：[README.md](../README.md)
- 当前单用户、无认证模型：[docs/SECURITY.md](SECURITY.md)
- 工具策略与 Bash fallback：[server/services/tools/toolPolicy.ts](../server/services/tools/toolPolicy.ts)、[server/services/tools/BashTool.ts](../server/services/tools/BashTool.ts)
- 迁移错误处理：[server/migrations/index.ts](../server/migrations/index.ts)
- TD-002 Harness 证据：[migration-fail-closed](changes/2026-09-06-migration-fail-closed/traceability.md)
- 最近一次评测快照：[agent-eval/viewer/report.json](../agent-eval/viewer/report.json)
- 启动与关闭生命周期整改：[server-lifecycle-remediation.md](architecture/server-lifecycle-remediation.md)
- 首次使用路径证据：[ChatPage.tsx](../client/src/features/chat/ChatPage.tsx)、[MessageList.tsx](../client/src/features/chat/components/MessageList.tsx)、[useChatRunActions.ts](../client/src/features/chat/hooks/useChatRunActions.ts)、[EndpointsPanel.tsx](../client/src/features/settings/components/EndpointsPanel.tsx)、[WikiSidebar.tsx](../client/src/features/wiki/WikiSidebar.tsx)
- TD-006 AgentRun 恢复闭环：[RecoveryCards.tsx](../client/src/features/chat/components/RecoveryCards.tsx)（运行状态 + 重试/放弃）、[agentRunRecoveryService.ts](../server/services/agentRunRecoveryService.ts)（`never`/`requires_confirmation`/`safe_idempotent` 恢复等级，未知工具默认 `requires_confirmation`）、[agentRunEventRepository.ts](../server/repositories/agentRunEventRepository.ts)（按 `(origin_run_id, action, idempotency_key)` 去重）；Harness 证据：[2026-09-18-agent-run-recoverable-persistence](../.harness/runs/2026-09-18-agent-run-recoverable-persistence/2026-09-19T09-41-16-679Z-57548/claim-verification.json)，8 项检查全通过、7/7 AC PASS。
- 产品规格/设计/执行计划索引：[docs/product-specs/README.md](product-specs/README.md)、[docs/design-docs/README.md](design-docs/README.md)、[docs/exec-plans/README.md](exec-plans/README.md)

### 2026-09-02 架构评审证据（支撑 TD-016～TD-029）

- 聊天引擎与配置语义：[reactLoopCore.ts](../server/services/reactLoopCore.ts)、[toolRoundEngine.ts](../server/services/toolRoundEngine.ts)、[aiProxy.ts](../server/services/aiProxy.ts)、[messageService.ts](../server/services/messageService.ts)
- AgentRun 事件与恢复：[agentRun.ts](../server/services/agentRun.ts)、[agentRunRecoveryService.ts](../server/services/agentRunRecoveryService.ts)、[approvalStore.ts](../server/services/tools/approvalStore.ts)
- 跨层类型与客户端传输：[server/types.ts](../server/types.ts)、[client types](../client/src/types/index.ts)、[preload.js](../electron/preload.js)、[_base.ts](../client/src/services/api/_base.ts)、[conversations.ts](../client/src/services/api/conversations.ts)、[wiki.ts](../client/src/services/api/wiki.ts)、[images.ts](../client/src/services/api/images.ts)
- schema、异步与层边界：[db.ts](../server/db.ts)、[migrations/index.ts](../server/migrations/index.ts)、[jobQueue.ts](../server/services/jobs/jobQueue.ts)、[sqliteJobStore.ts](../server/services/jobs/adapters/sqliteJobStore.ts)、[memoryJobRepository.ts](../server/repositories/memoryJobRepository.ts)、[encryption.ts](../server/services/utils/encryption.ts)、[boundary.test.ts](../server/architecture/__tests__/boundary.test.ts)
- 消息模型与组件耦合：[MessageList.tsx](../client/src/features/chat/components/MessageList.tsx)、[chatStreamCallbacks.ts](../client/src/features/chat/hooks/chatStreamCallbacks.ts)
- 工具链与仓库卫生：[package.json](../package.json)、[.gitignore](../.gitignore)、[ci.yml](../.github/workflows/ci.yml)、[AGENTS.md](../AGENTS.md)、[ARCHITECTURE.md](../ARCHITECTURE.md)
