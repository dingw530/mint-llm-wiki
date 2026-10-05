# 执行计划：Server 目录与领域边界收敛

## 文档信息

| 属性     | 值                                                     |
| -------- | ------------------------------------------------------ |
| 文档编号 | PLAN-20260929-001                                      |
| 状态     | 执行中（TP-4A～TP-4M 已验证；TP-5 拆包决策复盘待启动） |
| 创建日期 | 2026-09-29                                             |
| 关联设计 | [design-doc.md](design-doc.md)                         |
| 追溯     | [traceability.md](traceability.md)                     |

## 完成定义

- Server 目录职责图与依赖规则已落入架构文档和自动边界检查。
- 选定的低风险领域已按批次迁移，运行时和外部契约保持不变。
- 核心入口与 Agent Runtime 的高风险整理有单独 impact 证据及验证结果。
- 全部 AC 有可审阅证据；未完成/未验证项明确保留，不把目录搬迁本身视为验收通过。

## 范围与前置条件

- 范围：`server/` 的职责组织、内部导入边界、相关测试/构建配置及架构文档。
- 不含：产品行为、schema/API/SSE 变更、客户端重构、依赖新增和 workspace 拆分。
- 前置：每个 TP 开始前刷新/确认 GitNexus；检查 `git status` 并保留既有工作区改动；遵循 AGENTS 的格式、类型和构建要求。
- 每个子批次开始前刷新/确认 GitNexus，记录影响范围并锁定允许路径；TP-4A 已按用户明确指令进入执行。

## 分阶段任务

### TP-1：依赖盘点与边界规则设计

- 状态：待启动（需评审后）
- 关联：DS-1，AC-1、AC-4
- 工作：盘点所有 Server 源码入口、领域 import、循环依赖、动态加载、测试、tsconfig 输出目录、bundle/MCP/CLI/Electron 清单；对候选搬迁符号运行 impact。确定职责映射、禁止依赖和例外登记格式。
- 产出：职责映射表、import/入口清单、风险排序；更新 `docs/architecture/LAYERS.md` 和边界测试规则（如确认实施）。
- Probe：`node .gitnexus/run.cjs status`、候选符号 `impact`、静态 import 图/循环依赖检查、`npm run test:boundary`。
- 证据：impact 摘要、规则检查输出、职责映射审阅记录。
- 停止条件：候选模块 impact 为 UNKNOWN 且文本/配置检索不能补足引用范围；先拆小范围，不搬迁。

### TP-2：迁移首个低风险领域

- 状态：待启动（领域待 TP-1 排序）
- 关联：DS-2，AC-2、AC-3、AC-4
- 工作：按 TP-1 确定的单一领域迁移源文件和测试，更新所有已知 import、测试配置和路径相关文档；如有对外导入，仅按设计保留短期兼容 re-export。
- 产出：一个迁移完成的领域、测试/入口引用更新、执行记录。
- Probe：迁移目标的 `impact` 与全仓引用盘点；对应 vitest focused suite、server typecheck/build、bundle 入口检查、`npm run test:boundary`。
- 证据：命令结果、迁移前后路径清单、契约相关测试输出。

### TP-3：按证据扩展到相邻领域

- 状态：待启动（依赖 TP-2 复盘）
- 关联：DS-2，AC-2、AC-3、AC-4
- 工作：只有 TP-2 的依赖规则和验证方式有效时才扩展；每个领域单独提交工作批次和追溯记录。优先 Wiki/Memory/Routing 等已存在测试边界的业务域，实际顺序由 impact 决定。
- 产出：迁移领域目录、测试和消费方导入更新。
- Probe：各领域 impact、focused suite、typecheck/build、架构边界检查；覆盖持久化/后台作业时增加对应生命周期探针。
- 证据：逐领域的命令输出与 AC 映射。

### TP-4：高耦合运行时与入口边界收敛

- 状态：已验证（TP-4A～TP-4M 已完成；TP-5 独立待启动）
- 关联：DS-3，AC-2、AC-3、AC-4、AC-6～AC-9
- 工作：基于 TP-1 结果处理 `reactLoopCore`、`ServerRuntime`、`app.ts` 及 Tool 执行链的职责和依赖；先提取清晰接口/模块职责，再按需要移动文件。不得把 CRITICAL impact 当作普通搬迁处理。
- 产出：运行时/装配边界调整及契约说明；若发现需改变 API 或行为，暂停并开新变更范围。
- Probe：高影响符号 impact、React/AgentRun/SSE focused suites、启动/关闭测试、typecheck/build、MCP/CLI/Electron bundle 检查。
- 证据：高风险审查记录和上述探针结果。

#### TP-4 子批次（2026-10-04 设计补充）

按 TP-4A → TP-4B → TP-4C → TP-4D → TP-4E 顺序完成。实现、build、入口、Git 历史及正常 Hook 验证均已通过；实际文件清单和证据记录在本节执行记录中。

| 子任务                              | 状态         | 工作与路径范围                                                                                                              | AC                           | 证据                                                                                                                |
| ----------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| TP-4A：执行契约与显式装配           | 已完成       | 新增 Runtime ports/bootstrap；adapter 与工具注册改为幂等显式初始化；RunFactory 绑定移到 bootstrap                           | AC-2、AC-4、AC-6             | Runtime composition 测试、bootstrap 幂等测试、依赖边界测试、Server typecheck                                        |
| TP-4B：ReAct 状态机拆分             | 已完成       | `react-loop-core.ts` 承载 ReAct 状态机、预算、循环检测、上下文准备、结果归并及收尾                                          | AC-3、AC-4、AC-8             | 固定 adapter/tool stub 的 Runtime suite；预算、重试、取消、事件序列及并发结果顺序测试                               |
| TP-4C：生命周期与恢复               | 已完成       | AgentRun/events/recovery reducer 迁入 Runtime；SQLite 仓储进入 infrastructure；factory 在 bootstrap 绑定 observer           | AC-2、AC-4、AC-7             | AgentRun/事件仓储/恢复/审批 focused tests；写入顺序、唯一终态、快照复制和未知工具结果测试                           |
| TP-4D：输出与工具适配               | 已完成       | 输出契约与 HTTP/IPC/CLI 实现分离；审批 continuation 的消息落库提为单独应用适配；A2UI/Langfuse/MCP 保持显式能力端口          | AC-3、AC-4、AC-7、AC-8、AC-9 | sink/message/approval/security/A2UI tests；审批恢复保持 runId/sequence；ServerRuntime shutdown 测试                 |
| TP-4E：公共入口与目录搬迁           | 已完成       | 模块迁至 kebab-case `agent-runtime/`；生产入口使用 bootstrap；旧 `services/reactLoopCore.ts` facade 已删除                  | AC-2、AC-3、AC-4、AC-6、AC-9 | 全仓 source 验证、入口 smoke/bundle、Git rename 历史和正常提交 Hook 全部通过                                        |
| TP-4F：Settings、MCP 与向量基础设施 | 已完成并提交 | 设置、MCP 持久化/连接管理、模型与向量连接验证、SQLite/Chroma 向量服务迁至 infrastructure；原 API facade 保持调用契约        | AC-2、AC-3、AC-4             | 提交 `ca21878` 的正常 `verify:source`；Settings/MCP/vector 迁移记录                                                 |
| TP-4G：迁出剩余 API 应用模块        | 已完成并提交 | 应用用例移入 `application/`，Jev connection probe 归 infrastructure，删除冗余连接 re-export；各入口保持原契约               | AC-2、AC-3、AC-4             | `ca21878` 全量 Hook 通过；application 迁移记录及 `LAYERS.md`                                                        |
| TP-4H：其余 AI/Wiki/A2UI 服务归位   | 已完成并提交 | Wiki rerank 归 Wiki domain；Jev client、provider adapters 归 AI infrastructure；A2UI projection 归 transport infrastructure | AC-2、AC-3、AC-4             | `ca21878`：Server 1125/16 skipped、Client 90、eval 57、engineering 9/9、typecheck/lint/build；rename 历史见专项记录 |

#### TP-4 Tool 与 services 迁移子任务（2026-10-05，已实施）

| 子任务                                        | 状态             | 工作范围                                                                                                                                                                                                                                                   | AC                                        | 证据/停止门禁                                                                                                                                    |
| --------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| TP-4I：Tool 边界设计与评审                    | 已按用户指令确认 | 按提案 DS-5 确认 Runtime ports、catalog、执行流水线、MCP 动态工具及 handler 责任边界；方案依据 Pi/DeepSeek Harness 源码快照                                                                                                                                | AC-1、AC-4                                | 用户 2026-10-05 指令“goal 按工具调整方案实施”；方案见 `design-doc.md`                                                                            |
| TP-4J：Tool Runtime 契约与唯一执行路径        | 已实施           | Tool handler/context/metadata 与 ToolCatalog/ToolExecution 端口归 Agent Runtime；Registry、Executor、Policy、Approval Store 和 ToolRoundEngine 归 application，删除未经使用的直接执行旁路                                                                  | AC-2、AC-4、AC-6、AC-7、AC-8、AC-10       | Tool/审批/runtime focused suites、typecheck；旧 Registry/BaseTool 旁路仅有自调用，被删除后全仓引用检索为零                                       |
| TP-4K：Agent/MCP 目录与审批装配               | 已实施           | bootstrap 显式注册 handlers 并注入 Agent-scoped catalog、MCP client/adapter 和执行服务；保留 loaded/unloaded、legacy mode 与 server allowlist                                                                                                              | AC-2、AC-3、AC-7、AC-8、AC-9、AC-10       | catalog schema/allowlist/legacy tests、MCP adapter tests、审批 one-shot/runId continuation tests、Runtime composition tests                      |
| TP-4L：具体 Tool handler 分批迁移与旧入口退役 | 已验证           | Bash/HTTP/artifact 归 `infrastructure/tools`，MCP adapter 归 `infrastructure/mcp`；Wiki/Skills/Graph/Agent/MCP catalog tools 归 `application/tools`；删除旧 barrel/facades                                                                                 | AC-2、AC-3、AC-4、AC-7、AC-8、AC-10       | `verify:source` 通过；MCP build、Electron server bundle、CLI `--help` smoke 通过                                                                 |
| TP-4M：迁出 `server/services/` 剩余模块       | 已验证           | 消息/AI/context providers 归 `application/conversations`；Recovery/approval/retry 归 application/Agent Runtime；上下文契约归 Agent Runtime；network/filesystem/security/observability/resilience 归 infrastructure；纯 token estimator 迁至 `server/utils` | AC-2、AC-3、AC-4、AC-6、AC-7、AC-9、AC-11 | `server/services` 无 TS 源码；`verify:source` 全部通过；定向 suites 239 项、architecture suites 89 项通过；MCP/Electron bundle 与 CLI smoke 通过 |

各子批次采用相关源码目录下的既有 Vitest 用例为回归基线，只补足现有证据未覆盖的契约。重点覆盖：无工具流式回答、单/多工具往返、预算耗尽、重复调用、模型/工具失败及重试、取消、审批 approve/deny/过期/重复、重启后未知工具结果、上下文压缩、A2UI 引用和 token usage。验收比较语义事件及调用次数，不要求随机 runId 或时间戳相同；测试使用受控 provider/tool stub，不隐式发送真实知识库内容。

每批完成后运行对应 focused suites、Server typecheck/build、边界与格式检查；涉及具体交付入口时补对应 bundle/smoke。最终以正常 `verify:source` 和入口证据收敛。真实提供商行为或某交付入口未验证时明确登记，不能由 mock/bundle 成功推定运行验收通过。

2026-10-04 的评估结果为 AgentRun CRITICAL、`executeReactRun` UNKNOWN，且图查询有异常路径；启动任何子批次前必须重新确认该批 impact 与源码引用范围。不得把上述图结果当作普通目录移动的许可。

2026-10-04：TP-4F 完成源码搬迁与 focused 验证。设置存储适配器、MCP Server 仓储与连接管理、模型/向量连接验证以及向量持久化和 Chroma adapter 已迁至 infrastructure；端点和既有 application facade 保留。当前验证记录见 [Settings、MCP 与向量迁移证据](../../architecture/settings-mcp-vector-migration.md)。

2026-10-04：TP-4G 迁出剩余 `services/api/` TypeScript 模块。新增 `application/` 用例目录，Settings、MCP 配置、Memory spaces、会话 scope reservations、Agent Runtime approval 与 Wiki job facades 已移入；Jev connection probe 迁入 AI infrastructure，模型/向量连接旧 re-export 删除。上述变更已并入 `ca21878`。详情见 [Application services migration evidence](../../architecture/application-services-migration.md)。

2026-10-04：TP-4H 将 Wiki rerank、Jev client、VectorService/provider、AI provider adapters、A2UI composer/provider 分别迁至 Wiki domain、AI infrastructure、search infrastructure 与 transport infrastructure。提交 `ca21878` 的正常 `verify:source` Hook 全部通过，包含 typecheck、全量测试、engineering tests、lint 与构建。rename 记录中 Anthropic/OpenAI Responses 两个小文件需以 `--find-renames=20%` 追踪，详见 `ai-adapters-a2ui-migration.md`。

2026-10-05：用户授权 TP-4I 方案并将目标扩展到迁出 `server/services/` 所有剩余实现。TP-4J～TP-4M 已完成源码迁移与兼容入口退役。`npm run verify:source` 全部通过（Server/Client/agent-eval tests、engineering tests、typecheck、lint、build）；另行通过 MCP bundle、Electron server bundle、CLI `--help` smoke 与 `git diff --check`。完整路径映射和验证限制见 [Server services migration evidence](../../architecture/server-services-migration.md)。TP-5 拆包复盘仍待启动。

### TP-5：拆包决策复盘与文档收敛

- 状态：待启动
- 关联：DS-4，AC-1、AC-5
- 工作：用真实跨域依赖、复用方和独立发布需求复盘是否有领域达到独立包条件；无证据则记录继续单包的结论。整理最终职责图和例外债务。
- 产出：架构文档、追溯记录和是否拆包的决策记录。
- Probe：边界检查、完整验证矩阵复核、文档链接/ID/TP/AC 一致性检查。
- 证据：架构边界结果、文档审阅记录和拆包决策依据。

## 风险、依赖与回退

- 核心运行时是关键链路，TP-4 依赖前序边界证据，不与普通目录迁移并行。
- 任一批次若造成对外契约变化、动态入口无法追踪或构建产物缺失，回退该批路径变更并将职责提取保留为后续独立方案。
- GitNexus 执行流采样可能截断；每次高风险变更须结合文本检索、TypeScript 配置、打包清单和相关测试。
- 不覆盖或清理其他 worktree 改动；禁止通过 `--no-verify` 绕过提交钩子。

## 验收映射

| AC    | TP               | 证据                                                            |
| ----- | ---------------- | --------------------------------------------------------------- |
| AC-1  | TP-1、TP-5       | 架构职责图、规则检查、审阅记录                                  |
| AC-2  | TP-2、TP-3、TP-4 | impact、引用/入口清单、typecheck/build                          |
| AC-3  | TP-2、TP-3、TP-4 | focused tests、启动/打包探针                                    |
| AC-4  | TP-1 至 TP-5     | 架构边界检查和循环依赖检查                                      |
| AC-5  | TP-5             | 复盘决策记录                                                    |
| AC-6  | TP-4A、TP-4E     | 无副作用导入、幂等装配、Runtime 端口与依赖检查                  |
| AC-7  | TP-4C、TP-4D     | 事件持久化顺序、审批身份、恢复与未知副作用证据                  |
| AC-8  | TP-4B、TP-4D     | 预算/重试调用计数、并发结果排序、取消与目录刷新轨迹             |
| AC-9  | TP-4D、TP-4E     | transport、消息保存/流关闭顺序及各入口验收                      |
| AC-10 | TP-4I～TP-4L     | 唯一 ToolCatalog/ToolExecution 边界、策略流水线与无绕过的调用图 |
| AC-11 | TP-4M            | services 下无 TypeScript 实现；旧 imports 清零且入口/构建有效   |

## 执行记录

此前分批领域迁移的事实与证据记录在 `docs/architecture/*-migration.md` 及对应专项中；本次不将这些事实自动判为原提案所有 TP/AC 已完成。

2026-10-04：TP-4A～TP-4D 完成实现，TP-4E 验证进行中。新增/迁移文件包括 `server/agent-runtime/{agent-run,agent-run-persistence,agent-run-recovery-reducer,agent-status,contracts,output-sink,react-events,react-loop-core}.ts`、`server/bootstrap/{agent-run-factory,agent-runtime}.ts`、`server/infrastructure/persistence/agent-run-event-repository.ts` 和 `server/infrastructure/transports/sinks.ts`。旧 ReAct facade 已移除，HTTP 应用服务、CLI/eval、InvokeAgentTool 与审批 continuation 统一调用 bootstrap API。

已通过：`npm run verify:source`（typecheck、Server/client/eval 全量测试、engineering tests、全仓 lint 和 Server/eval/client 构建）；14 个 focused Vitest 文件/114 项通过；MCP bundle、Electron Server bundle、CLI `--help`、eval import smoke；Prettier、边界测试和 `git diff --check`。修复 `server/__tests__/dbInitialization.test.ts` 恢复 `AI_CHAT_DB_PATH` 的测试隔离，完整 source profile 与正常提交 Hook 均最终通过。

GitNexus 1.6.12 已重建当前仓库索引（17,287 nodes、33,927 edges、847 flows；全局流程采样有截断警告）。精确 impact：`AgentRun` CRITICAL（73 symbols、12 affected processes）；`executeReactRun` CRITICAL（9 symbols、10 affected processes）；`runAgentChat` CRITICAL（12 symbols、9 affected processes）。未用 shared-axis 值豁免 CRITICAL；按静态入口清单及工具/审批/恢复/ReAct/runtime 定向测试、bundle 和完整源验证核验。`detect-changes --scope all` 在最终提交前报告 50 changed files、162 symbols、90 affected processes，risk CRITICAL；变更图含未提交的文档索引修改，实际提交已限于本提案证据与 Server Runtime 实现。

历史与提交核验：`3bd3fda refactor(agent-runtime): move ReAct core with history` 以 96% rename 将原 `services/reactLoopCore.ts` 移至 `agent-runtime/react-loop-core.ts`；`git log --follow` 从新路径连续追溯到来源提交。`c29c8ec refactor(agent-runtime): finish ports and runtime migration` 完成 TP-4A～TP-4E；正常 Hook 的 `verify:source` 全部通过。未提交的 plugin/MCP、Codex plugin 变更及三个文档索引仍保持原状。
