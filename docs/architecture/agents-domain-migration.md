# Agents 配置管理领域迁移

日期：2026-10-03。基线：`b2ac34e`；保留先前未提交的 infrastructure 文件命名调整及 Codex plugin/MCP 相关内容。本批为工程重构，不改变产品规格、数据库 schema、HTTP/IPC/SSE 契约。

## 范围选择

Agent 管理服务只有 list、findById、create、update、remove 五个入口，实际业务规则是 Orchestrator 提示词后缀补充，其余委托给 Agent SQLite 仓储。GitNexus 的 Agent 服务文件 impact 为 MEDIUM、仓储文件为 LOW；相比 Wiki 主服务 CRITICAL、Skill 服务 HIGH，以及同时牵涉消息和会话状态的 Conversations，本批选择 Agents 配置管理这一小边界。

图谱查询出现异常字段及不可靠的流程展开，因此不把具体流程计数作为完整依赖证明；实际入口以当前源码路径盘点、类型检查、解析真实依赖的边界测试及完整源码验证补证。

范围不包含 AgentRun、ReAct、MCP 连接、工具审批或其他 Agent runtime 实现。

## 路径映射与依赖

| 原路径                                                  | 新路径                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `server/services/api/agentService.ts`                   | `server/domains/agents/agent-service.ts`                               |
| `server/repositories/agentRepository.ts`                | `server/infrastructure/persistence/agent-repository.ts`                |
| `server/services/api/__tests__/agentService.test.ts`    | `server/domains/agents/__tests__/agent-service.test.ts`                |
| `server/repositories/__tests__/agentRepository.test.ts` | `server/infrastructure/persistence/__tests__/agent-repository.test.ts` |

新增 `domains/agents/index.ts` 公共入口和 Agents 自动边界检查。沿用 Memory 的渐进边界：领域应用服务可依赖自己的 infrastructure 仓储；其他生产消费者使用公共应用 API，不直接访问 Agent 仓储。此服务没有后台资源或模型装配需求，不新增 bootstrap 或注入工厂。

更新静态导入、literal dynamic imports/mocks 与 Electron namespace re-export，共 16 个源码文件、29 处路径引用。消费者包括 Agent 端点、messageService、InvokeAgentTool、toolOrchestration、eval 和 Electron bundle；端点描述与导出符号保持原样。toolOrchestration 仅读取 available 和 mcpServerIds，通过原有 findById 应用 API 获得这些字段，其工具选择行为不变。

SQLite 仓储查询改用类型化 `prepare` 表达行类型，移除原有 `as AgentRow` 断言；SQL、读写行为、默认值和返回契约不变。移动的源文件主体保持可识别的相似度，避免整体重写。

## 验证

- 首轮 focused suite：11 个文件，97 项通过，覆盖 Agent 服务、真实 SQLite 仓储、工具编排/调用、消息/ReAct、IPC 及四类架构边界。
- 完整 `verify:source`：通过。Server 1039 项通过、16 项跳过；Client 90 项通过；agent-eval 57 项通过；工程测试、Server/Client 类型检查、lint 和各包构建通过。Electron server bundle、修改文件 Prettier check 与 git diff --check 通过。
- Git 历史候选检查：按“仓储在原路径的格式/行类型整理 → 领域迁移”两步候选提交，四个搬迁文件均通过默认 `git log --follow` 原提交集合核验，缺失数为 0。服务保留原 5 次提交、仓储保留原 2 次提交，两份测试各保留原 3 次提交。检查使用临时 index/object directory，不修改真实 index 或 refs。
- 正式提交时需保留上述拆分：将仓储格式/行类型变化与路径搬迁合并时，其相似度只有 48%，默认 rename detection 不追踪；分两步后搬迁相似度为 97%。其余三个文件的迁移相似度为 80%–93%。
- 未运行真实模型、浏览器、Electron 启动或独立 MCP 启动验收。本批没有新增前台交互或外部请求。

## 正式提交交付（2026-10-03）

已按准备、命名与领域边界拆分提交；所有正常提交 Hook 通过，未使用 no-verify。真实提交链中 40 个搬迁来源文件的默认 git log --follow 核验通过，旧提交缺失数为 0。代码工作区与最终验收快照逐文件一致。

- `e4b1f75`：refactor(server): prepare service and storage domain boundaries
- `03e07b8`：refactor(server): use kebab-case infrastructure filenames
- `0867f2c`：refactor(server): migrate agent and conversation management domains
- `e56bf1b`：refactor(knowledge): migrate skills graph and Wiki lifecycle domains

Codex plugin/MCP 的配置、插件目录、插件变更文档及相关索引条目保留未提交；没有推送。
