# 产品规格：可移植的 Agent Runtime 包

## 文档信息

| 属性     | 值                               |
| -------- | -------------------------------- |
| 变更标识 | 2026-10-08-react-runtime-package |
| 状态     | 已完成                           |
| 创建日期 | 2026-10-08                       |
| 优先级   | P1                               |

## 背景与目标

当前 `server/agent-runtime` 已有 ReAct 循环、工具注册与执行、运行事件和 Mint 生产组合，但这些能力尚未形成清楚、可单独依赖的包边界。ReAct 核心和工具运行实现都与 Mint 消息、权限、数据库、A2UI 及基础设施有不同程度的耦合。

本变更新增两个可独立构建和打包的最小框架包：`@mint/react-runtime` 管理 ReAct 轮次；`@mint/tool-runtime` 管理工具注册和单次工具执行边界。Mint 通过适配层提供模型、工具、权限、审批、重试、持久化、审计和传输能力。

## 用户与场景

- Node.js 项目开发者使用自己的模型客户端和工具运行 ReAct，不需要依赖 Mint server。
- Mint 保留现有 ReAct/SSE 行为，同时通过适配层调用通用框架。
- 工具执行失败、没有工具调用、步数耗尽或收到取消信号时，运行结果可预测且有界。

## 用户故事

- **US-001**：作为 Node.js 开发者，我希望通过稳定的模型、工具和事件接口运行 ReAct，从而在自己的项目中复用核心循环。
- **US-002**：作为 Mint 维护者，我希望把 Mint 类型和服务留在适配层，从而让框架包可以独立构建和打包。
- **US-003**：作为运行时维护者，我希望循环有步数上限、支持取消并保留工具结果顺序，从而避免无界运行和上下文错配。
- **US-004**：作为 Node.js 工具作者，我希望复用通用工具注册和执行边界，同时注入自己的校验、策略和执行逻辑。

## 范围

### 本次做

- 新增独立 npm workspace 包 `@mint/react-runtime`，仅依赖 TypeScript 构建工具，不依赖 Mint、模型 SDK、数据库或 UI。
- 提供通用消息、工具、模型端口、运行策略、事件和结果类型。
- 实现 ReAct 多轮循环：模型返回工具调用时执行已注册工具并回填结果；无工具调用或达到最大步数时结束。
- 支持 `AbortSignal`、有限最大步数、结构化工具错误和调用事件。
- 增加 Mint 适配层，将现有 `AgentRuntimePorts`、Mint 工具执行和事件映射到通用包。
- 保留现有公开 `runAgentChat` 入口及 Mint 端的审批、AgentRun、上下文压缩、A2UI、Wiki 引用和 SSE 语义。
- 提供不依赖真实 API Key 的 Node 使用示例或 smoke probe。
- 新增独立 npm workspace 包 `@mint/tool-runtime`，实现通用工具目录和单次执行流程。
- 保留 `BaseTool`、Mint 权限策略、审批存储、invocation ledger、安全重试、审计和 MCP/Wiki/Bash/HTTP 适配为宿主能力。
- Mint 的 `ToolRegistry` 和 `ToolExecutor` 通过薄适配使用新包；既有 `ToolExecutionService` 继续负责产品级编排。

### 本次不做

- 不增加第二种执行策略、工作流图、多 Agent 或计划执行器。
- 不把 Mint 的审批 UI、SQLite 持久化、恢复、MCP、Langfuse、A2UI 和 Wiki 逻辑搬进框架包。
- 不承诺模型供应商 SDK 适配器；模型端口由宿主实现。
- 不将 Mint 的权限规则、审批 UI、SQLite invocation 状态、审计后端、重试策略和领域工具搬进通用 Tool Runtime。
- 不发布 npm registry 包；完成独立打包验证即可。

## 业务规则

- **BR-001**：框架包运行时代码不得导入 Mint 源码、数据库、HTTP 框架、模型 SDK 或 UI 模块。
- **BR-002**：每次运行必须有正整数 `maxSteps` 上限；缺省策略使用有限默认值，输入非法值时拒绝运行。
- **BR-003**：工具调用按模型返回顺序执行，并按调用 ID 将结果回填到对应工具消息；一个工具失败不得伪装为成功。
- **BR-004**：模型与工具执行均接收运行取消信号；运行取消后不得继续启动后续模型轮次或工具调用。
- **BR-005**：框架产生 transport-neutral typed events；Mint 适配层负责映射现有 AgentRun/SSE 事件。
- **BR-006**：Mint 适配层继续通过现有 ToolExecutor 执行工具，框架不得直接持有 Mint 工具 handler 或绕过审批策略。
- **BR-007**：保持 `runAgentChat` 的现有参数和 `StreamResult` 行为兼容，除非测试证明不被调用方依赖的非公开内部细节。
- **BR-008**：两个通用包运行时代码均不得导入 Mint、数据库、HTTP 框架、模型 SDK、A2UI 或 UI 模块。
- **BR-009**：Tool Runtime 负责查找、启用状态、输入校验、宿主策略回调、取消/超时和结构化结果；宿主决定授权、审批、重试及持久副作用策略。
- **BR-010**：Mint 的所有生产工具执行仍经过 `ToolExecutionService` 和其 ToolExecutor adapter；新包不得提供可绕过服务端策略的第二执行路径。
- **BR-011**：Tool Runtime 默认不授权工具调用；每次执行必须获得宿主 policy gate 的明确 allow 决策，拒绝或审批等待时 execute 次数为 0。
- **BR-012**：Tool Runtime 管理单次执行、timeout/abort 和结构化结果；它不重试有副作用操作，也不持久化运行或调用状态。

## 验收标准

- **AC-001（high）**：框架包可独立 TypeScript 构建并生成可导入的 JavaScript 与声明文件；打包内容不包含 Mint 源码和运行时依赖。
- **AC-002（high）**：给定假模型和两个假工具，框架能按 ReAct 顺序完成多轮调用、将工具结果与 call ID 正确回填，并在模型返回最终回答后停止。
- **AC-003（high）**：框架在达到最大步数、收到 AbortSignal、未知工具、无效工具参数或工具执行失败时有确定的终态/错误事件，不再启动后续步骤。
- **AC-004（critical）**：Mint `runAgentChat` 经适配层调用框架后，保留现有流式回答、工具审批、AgentRun 终态、上下文处理、A2UI/Wiki 输出及 `StreamResult` 兼容行为；既有调用方回归通过。
- **AC-005（medium）**：文档示例仅使用自定义模型和工具即可运行，不需要 Mint server、真实模型 API Key 或数据库。
- **AC-006（high）**：`@mint/tool-runtime` 独立构建、打包，并能从 tarball 安装到临时 Node.js 项目后导入；运行时无 Mint 依赖。
- **AC-007（high）**：Tool Runtime 对未知/禁用工具、输入校验、宿主策略拒绝/审批、超时、取消和工具异常返回稳定结构化结果；拒绝/审批等待时 tool execute count 为 0。
- **AC-008（critical）**：Mint 生产工具执行经过 Tool Runtime adapter，同时保留 BaseTool 校验、Mint 权限/审批、retrySafety、invocation 状态、脱敏审计和既有 ToolCall 结果协议；相关工具安全与审批回归通过。
- **AC-009（medium）**：独立 Node 示例使用自定义工具和策略回调完成注册、拒绝和执行，不需要 Mint server、SQLite 或真实 API Key。

## 风险与依赖

- 当前 ReAct 主循环有大量 Mint 专属行为，接入通用循环可能改变事件顺序、流式语义或审批暂停行为。
- `reactChat` 和其间接执行路径调用广；必须保留兼容入口并进行调用方回归。
- Mint 尚有大量未提交的工具安全改动；本变更应避免覆盖或重排这些改动。
- 外部发布、版本策略和正式 npm registry 发布不在本次验收范围。
