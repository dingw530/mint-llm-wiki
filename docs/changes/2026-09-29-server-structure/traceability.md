# 追溯总览：Server 目录与领域边界收敛

## 状态

执行中。Agent Runtime 的 TP-4A～TP-4E 已完成并提交；其他已分批领域的状态和证据仍以专项及 `docs/architecture/*-migration.md` 记录为事实源。

## 追溯矩阵

| 需求/目标                    | 设计决策                                           | 验收标准                                                 | 执行任务         | 状态   |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------- | ---------------- | ------ |
| 领域职责清楚且依赖规则可检查 | DS-1：先盘点再定义职责和边界测试                   | AC-1：职责与方向有文档和自动检查证据                     | TP-1、TP-5       | 待启动 |
| 低风险模块分批迁移且引用完整 | DS-2：单包内领域迁移，单领域一批                   | AC-2：已知入口/引用均解析到目标位置                      | TP-2、TP-3       | 待启动 |
| 外部运行契约不变             | DS-2：迁移不改变 HTTP/SSE/DB/CLI/MCP/Electron 契约 | AC-3：对应测试、构建和入口探针通过                       | TP-2、TP-3、TP-4 | 进行中 |
| 无循环依赖和新增违规         | DS-1：架构约束与例外退出条件                       | AC-4：自动检查无新增违规                                 | TP-1 至 TP-5     | 进行中 |
| 拆包基于独立演进证据         | DS-4：暂留单包，复盘后决策                         | AC-5：有复盘证据；无证据则不拆                           | TP-5             | 待启动 |
| Runtime 导入与装配职责清楚   | DS-3：显式端口与 bootstrap 装配                    | AC-6：核心无具体实现依赖和导入初始化副作用               | TP-4A、TP-4E     | 已完成 |
| 生命周期、审批和恢复语义保持 | DS-3：运行规则与持久化/会话适配分离                | AC-7：持久化顺序、唯一终态、审批身份及未知工具副作用保持 | TP-4C、TP-4D     | 已完成 |
| 执行策略和工具时序保持       | DS-3：ReAct 状态机与模型/工具能力分离              | AC-8：预算、重试、结果排序、取消和目录刷新保持           | TP-4B、TP-4D     | 已完成 |
| 多入口使用同一执行核心       | DS-3：公共 Runtime API 与 transport subscriber     | AC-9：输出、消息保存及流关闭顺序保持                     | TP-4D、TP-4E     | 已完成 |

## 偏差记录

| 日期 | 类型 | TP  | 文件 | 原因 | 影响 | 后续动作 |
| ---- | ---- | --- | ---- | ---- | ---- | -------- |
| —    | —    | —   | —    | 暂无 | —    | —        |

## 执行记录

2026-10-04：TP-4F 迁移 Settings/MCP/连接管理/向量基础设施，旧配置与 API 行为由现有 service、bootstrap 和 endpoint facade 保持。Server typecheck 通过；16 个 focused Vitest 文件/133 项通过，包含架构边界测试；Prettier、旧路径扫描及 `git diff --check` 通过。临时 Git index 识别出七组移动；MCP Server 仓储相似度为 28%，需在提交后用 `git log --follow --find-renames=20%` 检查旧历史。详细路径与验证边界见 `docs/architecture/settings-mcp-vector-migration.md`。

2026-10-04：TP-4G 迁出剩余 `services/api/` TypeScript 源码和测试；HTTP/CLI/Runtime/Electron 消费者路径已指向 application 或基础设施模块。Server typecheck 通过；18 个 focused Vitest 文件/136 项通过，包含架构边界测试；Prettier、旧路径扫描、`git diff --check` 及 50% rename 探测通过。详细映射、影响与验证边界见 `docs/architecture/application-services-migration.md`。

初始提案阶段只完成文档草拟，后续独立领域迁移见专项记录。2026-10-04 按补充设计完成 TP-4A～TP-4E：Runtime 端口与 bootstrap 显式装配、ReAct 状态机、AgentRun/events/recovery reducer、SQLite 仓储适配、transport sink 分层、审批结果消息持久化拆分及入口迁移均已实现。旧 `services/reactLoopCore.ts` facade 删除，生产 ReAct 调用方改用 `bootstrap/agent-runtime.ts`。

验证记录：最终源码状态下 `npm run verify:source` 全部通过，覆盖 typecheck、Server/client/eval 全量测试、engineering tests、全仓 lint 和 Server/eval/client 构建。另有 MCP/Electron bundle、CLI/eval smoke、Runtime 边界、Prettier 和 `git diff --check` 通过。为避免环境变量跨测试文件泄漏，`dbInitialization.test.ts` 现在恢复 Vitest 配置的隔离数据库路径；完整验证在隔离 DB 与允许 loopback 的环境下完成。

GitNexus 1.6.12 索引重建成功；精确 impact 对 `AgentRun`、`executeReactRun`、`runAgentChat` 均为 CRITICAL。`detect-changes --scope all` 识别 50 files、162 symbols、90 affected processes、CRITICAL；运行流全局抽样有截断提示。已结合源码调用点和完整验证逐项审查，不以空调用集合或风险轴豁免。提交 `3bd3fda` 以 96% rename 移动 ReAct 核心，并通过 `git log --follow` 追回原提交集合；`c29c8ec` 完成 Runtime 改造，正常 Hook 的 `verify:source` 全部通过。plugin/MCP、Codex plugin 和文档索引等无关工作区改动保留未提交。

## 关联专项

2026-09-30 新增 [Memory 领域专项设计](../2026-09-30-memory-context-optimization/design-doc.md) 与 [计划](../2026-09-30-memory-context-optimization/exec-plan.md)，细化本提案中的 Memory 边界和迁移映射。该专项已完成：Memory 子域边界、infrastructure/bootstrap、领域迁移、HTTP/IPC 与用户管理流程均有实际源码和 Harness 证据，专项 AC-001～AC-013 全部 PASS。此记录只关闭 Memory 专项映射，不推进本提案其他 TP，也不改变本提案整体待评审状态。
