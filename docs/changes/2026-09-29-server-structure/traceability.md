# 追溯总览：Server 目录与领域边界收敛

## 状态

执行中。TP-4A～TP-4H 已由 `ca21878` 提交；用户于 2026-10-05 授权实施 Tool 方案并扩展迁出 `server/services/`。TP-4J～TP-4M 已实施并通过 `verify:source`；TP-5 拆包决策复盘仍待启动。分批领域路径和证据仍以 `docs/architecture/*-migration.md` 为事实源。

## 追溯矩阵

| 需求/目标                           | 设计决策                                                            | 验收标准                                                         | 执行任务         | 状态             |
| ----------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------- | ---------------- |
| 领域职责清楚且依赖规则可检查        | DS-1：先盘点再定义职责和边界测试                                    | AC-1：职责与方向有文档和自动检查证据                             | TP-1、TP-5       | 进行中           |
| 低风险模块分批迁移且引用完整        | DS-2：单包内领域迁移，单领域一批                                    | AC-2：已知入口/引用均解析到目标位置                              | TP-2、TP-3       | 已完成所选批次   |
| 外部运行契约不变                    | DS-2：迁移不改变 HTTP/SSE/DB/CLI/MCP/Electron 契约                  | AC-3：对应测试、构建和入口探针通过                               | TP-2、TP-3、TP-4 | 已验证已提交批次 |
| 无循环依赖和新增违规                | DS-1：架构约束与例外退出条件                                        | AC-4：自动检查无新增违规                                         | TP-1 至 TP-5     | 进行中           |
| 拆包基于独立演进证据                | DS-4：暂留单包，复盘后决策                                          | AC-5：有复盘证据；无证据则不拆                                   | TP-5             | 待启动           |
| Runtime 导入与装配职责清楚          | DS-3：显式端口与 bootstrap 装配                                     | AC-6：核心无具体实现依赖和导入初始化副作用                       | TP-4A、TP-4E     | 已完成           |
| 生命周期、审批和恢复语义保持        | DS-3：运行规则与持久化/会话适配分离                                 | AC-7：持久化顺序、唯一终态、审批身份及未知工具副作用保持         | TP-4C、TP-4D     | 已完成           |
| 执行策略和工具时序保持              | DS-3：ReAct 状态机与模型/工具能力分离                               | AC-8：预算、重试、结果排序、取消和目录刷新保持                   | TP-4B、TP-4D     | 已完成           |
| 多入口使用同一执行核心              | DS-3：公共 Runtime API 与 transport subscriber                      | AC-9：输出、消息保存及流关闭顺序保持                             | TP-4D、TP-4E     | 已完成           |
| 工具目录与执行策略单一归属          | DS-5：Tool 为跨域能力适配层，Runtime 通过端口调用                   | AC-10：无平行执行路径，校验/授权/审批/超时/审计可证明            | TP-4I～TP-4L     | 已验证           |
| `server/services/` 不再承载实现模块 | DS-6：每个模块迁至 Runtime/domain/application/infrastructure 所有者 | AC-11：无 services 下 TypeScript 实现或生产 import；入口契约不变 | TP-4M            | 已验证           |

## 偏差记录

| 日期 | 类型 | TP  | 文件 | 原因 | 影响 | 后续动作 |
| ---- | ---- | --- | ---- | ---- | ---- | -------- |
| —    | —    | —   | —    | 暂无 | —    | —        |

## 执行记录

2026-10-04：TP-4F 迁移 Settings/MCP/连接管理/向量基础设施，旧配置与 API 行为由现有 application/bootstrap 与 endpoint facade 保持。Server typecheck 通过；16 个 focused Vitest 文件/133 项通过，包含架构边界测试；Prettier、旧路径扫描及 `git diff --check` 通过。详细路径与验证边界见 `docs/architecture/settings-mcp-vector-migration.md`。

2026-10-04：TP-4G 迁出剩余 `services/api/` TypeScript 源码和测试；HTTP/CLI/Runtime/Electron 消费者路径已指向 application 或基础设施模块。Server typecheck 通过；18 个 focused Vitest 文件/136 项通过，包含架构边界测试；Prettier、旧路径扫描、`git diff --check` 及 rename 探测通过。详细映射、影响与验证边界见 `docs/architecture/application-services-migration.md`。

初始提案阶段只完成文档草拟，后续独立领域迁移见专项记录。2026-10-04 按补充设计完成 TP-4A～TP-4E：Runtime 端口与 bootstrap 显式装配、ReAct 状态机、AgentRun/events/recovery reducer、SQLite 仓储适配、transport sink 分层、审批结果消息持久化拆分及入口迁移均已实现。旧 `services/reactLoopCore.ts` facade 删除，生产 ReAct 调用方改用 `bootstrap/agent-runtime.ts`。

验证记录：最终源码状态下 `npm run verify:source` 全部通过，覆盖 typecheck、Server/client/eval 全量测试、engineering tests、全仓 lint 和 Server/eval/client 构建。另有 MCP/Electron bundle、CLI/eval smoke、Runtime 边界、Prettier 和 `git diff --check` 通过。为避免环境变量跨测试文件泄漏，`dbInitialization.test.ts` 现在恢复 Vitest 配置的隔离数据库路径；完整验证在隔离 DB 与允许 loopback 的环境下完成。

GitNexus 1.6.12 索引重建成功；精确 impact 对 `AgentRun`、`executeReactRun`、`runAgentChat` 均为 CRITICAL。`detect-changes --scope all` 识别 50 files、162 symbols、90 affected processes、CRITICAL；运行流全局抽样有截断提示。已结合源码调用点和完整验证逐项审查，不以空调用集合或风险轴豁免。提交 `3bd3fda` 以 96% rename 移动 ReAct 核心，并通过 `git log --follow` 追回原提交集合；`c29c8ec` 完成 Runtime 改造，正常 Hook 的 `verify:source` 全部通过。plugin/MCP、Codex plugin 和文档索引等无关工作区改动保留未提交。

2026-10-04：提交 `ca21878 refactor(server): move AI, Wiki, and A2UI modules to layer owners` 将 TP-4F～TP-4H 的未提交迁移合并为一批，包括 Wiki rerank、Jev/vector、provider adapters 与 A2UI transport；Settings/MCP/连接管理和 application 用例迁移记录同步归档。正常 `verify:source` Hook 全部通过：Server 1125 项通过/16 项跳过、Client 90 项、agent-eval 57 项、engineering 9/9、typecheck/lint/build 全部通过。插件、评测数据、架构图及文档索引改动留在工作区，未混入提交。

2026-10-05：基于 Mint 当前工具调用链，以及 Pi coding-agent `0.84.2@b7bb00b93`、DeepSeek Harness `47f943859b` 的本地源码快照，完成 TP-4I Tool 迁移方案；用户明确指示按方案实施。GitNexus 1.6.12 索引刷新后，ToolExecutor impact 为 LOW（13 impacted），ToolRegistry 为 MEDIUM（21 impacted，涉及 `executeToolCall` 和 `resolveToolApproval`），ToolLoopEngine 为 MEDIUM（23 impacted）；McpToolAdapter 为 CRITICAL/lower-bound（受 BaseTool 动态派发影响），故按分批迁移并以源码、入口及测试补充图谱边界。TP-4J 已启动。

2026-10-05：TP-4J～TP-4M 将 Runtime Tool contracts、Catalog/Execution、ApprovalStore/Policy、ToolRoundEngine、MCP adapter、具体 handlers、会话用例、ContextProviders、Recovery、RuntimeContext、resilience/network/filesystem/security/observability 模块迁至目标所有者。`bootstrap/tool-registry.ts` 显式注册 handlers；`server/services/` 无 TypeScript 源码，旧实现 imports 清零。

2026-10-05：TP-4M 完成。`server/services/` 下无 TypeScript 源文件，现有调用方已分别指向 `application/conversations`、`application/agent-runtime`、`agent-runtime`、`infrastructure/*` 与 `server/utils/token-estimator.ts`。最终 `npm run verify:source` 通过，包含 Server/Client/agent-eval 全量测试、engineering tests、typecheck、lint 及构建；额外验证 `build:mcp`、Electron server bundle、CLI `--help` 与 `git diff --check` 通过。完整迁移表与限制见 `docs/architecture/server-services-migration.md`。未调用真实模型 provider 或在线 MCP server。

## 关联专项

2026-09-30 新增 [Memory 领域专项设计](../2026-09-30-memory-context-optimization/design-doc.md) 与 [计划](../2026-09-30-memory-context-optimization/exec-plan.md)，细化本提案中的 Memory 边界和迁移映射。该专项已完成：Memory 子域边界、infrastructure/bootstrap、领域迁移、HTTP/IPC 与用户管理流程均有实际源码和 Harness 证据，专项 AC-001～AC-013 全部 PASS。此记录只关闭 Memory 专项映射，不推进 TP-5 拆包复盘。
