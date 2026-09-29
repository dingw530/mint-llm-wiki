# 设计提案：Server 目录与领域边界收敛

## 文档信息

| 属性 | 值 |
|---|---|
| 文档编号 | DSGN-20260929-001 |
| 状态 | 提案，待评审 |
| 创建日期 | 2026-09-29 |
| 关联执行计划 | [exec-plan.md](exec-plan.md) |
| 追溯 | [traceability.md](traceability.md) |

## 背景

Mint 的 `server/` 已有 `repositories/`、`endpoints/`、`runtime/`、`adapters/` 和若干领域子目录，但 `services/` 同时容纳业务服务、Agent Run/ReAct 执行链、AI 代理、消息服务和工具编排。`services/api/` 聚集了 Wiki、Memory、Routing、Agent、配置等业务领域。现有架构测试能约束顶层层次，却不能表达服务领域之间允许的依赖方向。

评估时 GitNexus 索引已刷新至当前工作区。`createApp` 和 `ServerRuntime` 影响分析均为 CRITICAL；前者有 144 个直接调用并关联 67 条流程，后者关联 157 条流程。执行流报告有采样截断，因此这些结果用于识别高风险边界，不视为完整调用清单。

参考 Pi 的做法，独立、可复用的能力可以成为包；deepseek-harness 展示了更细的领域包拆分。Mint 暂无证据表明这些业务域需要独立发布或版本演进，因此本提案先在单一 `server/` 包内落实领域目录和依赖约束，不直接引入 workspace 拆包。

## 目标与非目标

**目标**

- 让目录能表达入口、基础设施、业务领域和 Agent 执行时序的职责。
- 让领域依赖方向可检查，避免业务域互相绕过服务边界。
- 以小批次迁移，维持 HTTP、SSE、持久化和 CLI/Electron 运行契约。

**非目标**

- 不改变产品行为、API/SSE 契约或数据库 schema。
- 不将 Server 拆为微服务，不新增依赖注入框架。
- 在没有独立发布/复用需求证据前，不创建多个 npm workspace 包。
- 不在首批直接移动 `app.ts`、`ServerRuntime` 或大规模拆分 `reactLoopCore.ts`。

## 方案与决策

### 方案 A：保持单包，收敛领域目录与边界（推荐）

保留现有基础层，明确 Server 内部职责：

```text
server/
  bootstrap/             # 进程入口与启动装配（现有 index/runtime 逐步归位）
  http/                  # Express app、middleware、routes、endpoint 注册
  infrastructure/        # db、migrations、repositories、adapters、外部服务客户端
  domains/
    conversations/       # 会话、消息、AgentRun 持久化与应用服务
    wiki/                # Wiki 搜索、摄入、生命周期与向量作业
    memory/              # 记忆服务、作业与分类
    routing/              # 路由决策、连接与 Provider
    agents/                # Agent 配置、审批与运行协调
  agent-runtime/          # ReAct 循环、工具回合、事件 sink、工具注册/执行
  cli/ eval/ mcp/          # 独立交付入口
  shared/                 # 跨领域纯类型/小型纯函数，仅在确有共享时使用
```

这是目标职责图，不要求一次性创建全部目录。初期可保留 `services/` 路径；每次迁移以一个领域为单位，确认导入、构建入口和打包配置后再调整物理目录。命名以实际模块职责和现有依赖图为准。

领域依赖规则：HTTP/CLI 入口调用领域应用服务；领域服务依赖领域仓储端口或 infrastructure 实现，不由领域直接调用另一个领域的内部文件；Agent Runtime 通过显式上下文/接口调用业务能力；基础类型和纯函数不得反向依赖运行时或入口。跨域协作先通过应用服务接口，只有重复且稳定的契约才提升到 shared。

### 方案 B：拆成多个 workspace 包

每个领域拥有 package manifest、构建产物和独立测试边界。该方案边界最强，但会引入版本/构建/打包/类型解析成本；当前没有独立发布或复用证据，暂不采用。若后续领域确需独立发布，再以单个成熟领域试拆。

### 方案 C：只重命名现有目录

成本低，但 `services/api` 内部仍缺少领域依赖约束，无法解决根因，不单独采用。

## 设计决策

- **DS-1：先定义可检查的领域边界。** 依据静态依赖、入口和 impact 盘点确定职责与规则，不以目录名称推断边界。
- **DS-2：保留单一 Server 包并按领域小批迁移。** 首批目标由 TP-1 的依赖/风险证据决定，每批验证后再扩展。
- **DS-3：核心入口与 Agent Runtime 先拆职责再迁移。** `app.ts`、`ServerRuntime`、`reactLoopCore` 的高影响链路不做大规模机械搬迁。
- **DS-4：workspace 拆分作为证据驱动的后续决策。** 当前不拆包；只有出现独立发布、稳定复用或独立演进需求时再评估。

## 迁移原则

1. 先盘点 import 图、动态加载、测试、TypeScript 输出路径、Electron bundle、MCP/CLI 入口和脚本，再设定每批路径范围。
2. 每个 TP 只移动一个低风险领域，或只提取一个边界；改文件路径时同步调整测试和构建配置。
3. 物理搬迁前运行 GitNexus impact；若为 HIGH/CRITICAL，优先拆职责/接口并增加探针，不做纯移动式的大批量改动。
4. 保持旧导出路径为短期兼容 re-export（仅当外部入口确有依赖），记录移除条件；禁止无依据长期双实现。
5. 禁止循环依赖与领域间深层相对路径；以架构测试/静态检查表达边界，允许项必须有负责人和退出条件。

## 风险与控制

| 风险 | 控制 |
|---|---|
| 大量路径变更遗漏动态导入、脚本或 Electron bundle | 迁移前检索静态/动态引用并逐一检查打包入口；分批验证 |
| Agent Runtime 与业务域边界切分错误 | 先以调用上下文/端口厘清依赖，再迁移；SSE 事件契约保持不变 |
| 架构规则过严导致无意义抽象 | 先约束运行时依赖和跨域内部导入；共享只在有真实复用时形成 |
| GitNexus 流程采样不完整 | 同时核对文本导入、TS 配置、脚本及构建清单；不能以零调用作安全结论 |
| 旧 Server 架构计划重复 | 2026-06-10 计划聚焦工具循环、Express 耦合、错误处理、配置与日志，相关 TP 已记录完成；本提案仅处理当前领域组织与边界，不重开旧目标 |

## 验收证据矩阵

| AC | 风险 | 不变量 | 最低证据 | 关联 TP |
|---|---|---|---|---|
| AC-1 | 中 | Server 各目录职责及依赖方向有文档定义，领域边界能由自动检查表达 | 边界检查结果与架构文档审阅 | TP-1 |
| AC-2 | 高 | 每次迁移后被迁移模块、其测试和所有已知入口均解析到新位置 | GitNexus impact、引用盘点、typecheck/build 结果 | TP-2 至 TP-4 |
| AC-3 | 高 | HTTP、SSE、CLI/MCP、Electron bundle、DB 行为无契约变化 | 对应 focused tests、build、入口/打包探针；本变更不涉及 UI，无浏览器验收 | TP-2 至 TP-4 |
| AC-4 | 中 | 不存在新领域循环依赖或未登记的边界违规 | 架构边界检查通过，违规清单无新增 | TP-1 至 TP-4 |
| AC-5 | 低 | 是否拆 workspace 由复用/发布证据决定，未验证时不拆包 | 迁移复盘记录和依赖边界证据 | TP-5 |

## 待评审事项

- 首批迁移领域按 GitNexus 和静态依赖盘点后的风险排序确定；优先选择低耦合且测试独立的服务，不预设一定是 Memory 或 Routing。
- `agent-runtime/` 是否需要作为独立顶层目录，在首轮职责盘点后确认；若与现有 `services/runtime` 重叠则合并命名。
- 目标结构中的 `http/`、`infrastructure/` 是职责分组，不要求强行包含所有兼容入口；具体物理路径在 TP-1 完成后定稿。
