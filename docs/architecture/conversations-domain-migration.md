# Conversations 会话管理领域迁移

日期：2026-10-03。基线：`b2ac34e`，保留未提交的 infrastructure 命名及 Agents 迁移。工程重构，不改变 HTTP/IPC/SSE、schema 或产品规格。

## 范围与依赖

| 原路径                                          | 新路径                                                         |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `apps/server/services/api/conversationService.ts`    | `apps/server/domains/conversations/conversation-service.ts`         |
| `apps/server/repositories/conversationRepository.ts` | `apps/server/infrastructure/persistence/conversation-repository.ts` |

新增 Conversations 公共入口、基础设施默认配置适配器、架构边界规则及测试、真实 SQLite 会话管理测试。领域负责列表、创建、删除、重命名、Agent 锁定，以及供消息初始化使用的 nullable metadata lookup；默认路由模式通过配置适配器读取既有 settings storage，由领域保留 auto fallback。

消费者涉及会话端点/路由、CLI commands/REPL、Electron namespace 和 messageService；相关 mocks/fixtures 一同更新，共 16 个源码/脚本文件、20 处路径引用。编译后的 memory process smoke 动态 import 指向新的仓储路径，仍通过专用临时 DB 构建测试数据。

消息发送、Agent 执行时序、conversationScopeLock 的活动运行预留，以及 Memory 的空间归属应用适配器仍保持原位置。此小边界不新增 bootstrap 或后台资源，不移动其他服务模块。

既有 SQL、类型过滤、排序、cascade、404/400、缺失元数据返回 null、默认标题 New Chat、配置路由模式和 Agent 解锁语义保持不变。仓储读查询使用类型化 prepare 代替旧的 Row 类型断言。default config 适配器使领域不直接导入未迁移的 settings repository。

## 风险与验证

- GitNexus impact：管理服务 MEDIUM，仓储 HIGH。链路涉及消息、CLI、Electron 和会话端点；没有把有异常字段/流程展开的图谱结果视为完整证明。
- focused suite：8 个文件、67 项通过，包含 7 项新增真实 SQLite 会话管理测试和 Conversations 边界检查，以及原消息/ReAct和其他领域边界测试。
- 完整 verify:source：通过。Server 1052 项通过、16 项跳过；Client 90 项通过；agent-eval 57 项通过；类型检查、工程测试、lint 和各包构建通过。Electron server bundle、修改文件 Prettier check 及 git diff --check 通过。
- 历史检查按“仓储在旧路径格式/行类型准备 → 领域搬迁”两步候选提交，两个源文件的原提交集合均由默认 git log --follow 完整找回。服务和仓储各保留原 4 次提交。服务搬迁相似度 64%，仓储在格式/类型准备后的搬迁相似度 96%。检查使用临时 index/object directory，不创建真实提交或修改真实 index/refs；正式提交时应保留这两步。
- 隔离临时 DB 的 memory-process-smoke 通过：CLI chat 和 REPL 各检索并注入一条记忆；重启后 access_count 为 2，持久化用户消息为 2；真实模型调用为 0。
- 未进行真实模型、浏览器、Electron 启动或独立 MCP 启动验收。插件/MCP 配置及文档保持原状。

## 正式提交交付（2026-10-03）

已按准备、命名与领域边界拆分提交；所有正常提交 Hook 通过，未使用 no-verify。真实提交链中 40 个搬迁来源文件的默认 git log --follow 核验通过，旧提交缺失数为 0。代码工作区与最终验收快照逐文件一致。

- `e4b1f75`：refactor(server): prepare service and storage domain boundaries
- `03e07b8`：refactor(server): use kebab-case infrastructure filenames
- `0867f2c`：refactor(server): migrate agent and conversation management domains
- `e56bf1b`：refactor(knowledge): migrate skills graph and Wiki lifecycle domains

Codex plugin/MCP 的配置、插件目录、插件变更文档及相关索引条目保留未提交；没有推送。
