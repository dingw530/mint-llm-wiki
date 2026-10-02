# Routing 领域迁移记录

日期：2026-10-02。基线：develop / `be427e173b74c69f60eef183ce090b4566ea758a`。

本批为工程重构，消费 `2026-09-29-server-structure` 提案中的领域边界方向，不代表该提案全部完成。不改变 Agent 选择规则、置信度、provider 降级、hooks、routing_logs schema、端点分页或 SSE；Express HTTP 路由不属于本批。

## 职责与文件映射

| 原路径（server/ 下）                                                                     | 新路径（server/ 下）                                                                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| services/api/routingService.ts                                                           | domains/routing/routing-service.ts                                                     |
| services/routingProviders/routingPolicy.ts                                               | domains/routing/routing-policy.ts                                                      |
| services/routingProviders/legacyRoutingProvider.ts                                       | domains/routing/legacy-routing-provider.ts                                             |
| services/routingProviders/keywordExactProvider.ts                                        | domains/routing/keyword-exact-provider.ts                                              |
| services/routingProviders/types.ts、index.ts                                             | domains/routing/ 对应同名文件                                                          |
| services/routingProviders/defaultRoutingSteps.ts                                         | bootstrap/routingSteps.ts                                                              |
| services/routingProviders/jevRoutingProvider.ts                                          | infrastructure/ai/jevRoutingProvider.ts                                                |
| repositories/routingLogRepository.ts                                                     | infrastructure/persistence/routingLogRepository.ts                                     |
| services/api/**tests**/routing.test.ts、routingService.test.ts                           | domains/routing/**tests**/ `routing.test.ts`、`routing-service.test.ts`                |
| services/routingProviders/**tests**/routingPolicy.test.ts、legacyRoutingProvider.test.ts | domains/routing/**tests**/ `routing-policy.test.ts`、`legacy-routing-provider.test.ts` |
| services/routingProviders/**tests**/jevRoutingProvider.test.ts                           | infrastructure/ai/**tests**/jevRoutingProvider.test.ts                                 |

新增 `domains/routing/ports.ts`、`infrastructure/ai/llmRoutingClassifier.ts`、`infrastructure/persistence/routingLogWriter.ts`、`bootstrap/routing.ts` 和 Routing 架构边界检查。LLM 分类主体从 legacy provider 提取；日志写入从 use case 提取。领域保留 hooks、锁定/手动模式、关键词规则、阈值及 fallback。provider 顺序和无状态实例由 bootstrap 装配。

更新消费者：messageService、eval、routingLogs endpoint、repository 测试及 messageService/ReAct mocks。bootstrap 保留既有 `new RoutingService(hooks?, stepFactory?)` 构造方式；领域类显式接收 runtime ports。

## 影响核验

- GitNexus 原索引落后三次 Memory 提交；用本机缓存 CLI 1.6.12 成功刷新到当前基线，未更改 AGENTS/skills。
- RoutingService impact 为 LOW，直接消费者为 messageService 与 eval。provider types、legacy provider 和 messageService 的文件 impact 为 MEDIUM；其他迁移源文件为 LOW。
- eval 文件 impact 为 UNKNOWN；文本补证确认评测包通过 `mint-server/eval` 动态导入 createReactExecutor，已纳入评测包构建。
- 全工作区 detect-changes 聚合结果为 critical，包含旧文件删除以及既有未提交文档。它不能等同于领域的行为风险结论；新文件尚未提交，Git diff 的图谱分析不覆盖全部未跟踪文件。以类型检查、解析实际依赖的边界测试和迁移测试补证。
- Analyzer 提示执行流采样存在截断；没有把空 flow/caller 集合视为完整依赖证明。

## Git 历史验证

提交按 Routing 领域迁移与领域文件命名统一两批组织，没有重写、重置、变基或压缩既有提交。

使用 `/tmp` 中的独立 index/object directory 构建候选 tree 和临时 commit object，以当前 HEAD 为 parent；未修改项目 index、objects 或 refs。默认 `git diff --cached -M` 识别全部 **14 个文件为重命名**，相似度 58%–100%。对每个新路径执行候选提交上的 `git log --follow --format=%H`，逐一核对原路径的完整提交集合：**14/14 通过，缺失提交为 0**。

其中 RoutingService 保留原来的 8 次历史提交，routing.test.ts 保留 4 次，routingService.test.ts 保留 6 次，Jev provider 保留 2 次；其余各保留 1 次。

这是当前候选内容的追溯验证。正式提交应将搬迁源路径删除、新路径及引用更新纳入同一提交，避免只提交新文件；后续大幅改写内容需要重新检查 rename detection。提交后可使用：

```sh
git log --follow -- server/domains/routing/routing-service.ts
git blame -M -C -- server/domains/routing/routing-service.ts
```

## 验证结果与限制

- 相关 Vitest：13 个文件，125 项通过，包含关键词/LLM/Jev、provider 阈值与降级、hooks/运行时 ports、消息/ReAct、routing_logs repository、评测引用与架构边界。
- Server typecheck、Server build、agent-eval build：通过。
- Electron server bundle 和 MCP bundle：构建通过。MCP 构建保留既有 `db.ts` 的两条 CJS/import.meta 警告；未作为运行验证。
- server ESLint、本批文件 Prettier check、git diff --check：通过。
- 未执行真实 Jev/LLM 请求、浏览器功能验收、Electron 启动、MCP 启动或完整 Harness/全量测试。本批没有 UI、端点契约或数据库 schema 变更。
- 保留任务开始前的 client/index.html、文档索引及未跟踪插件/配置等工作区内容。

## 领域文件命名统一（2026-10-02）

仅将已迁移的 `server/domains/` 文件统一为 kebab-case：Memory 17 个、Routing 8 个，共 25 个（含测试）。同步更新 30 个源码文件中的 72 处路径引用、两份 Memory Harness 检查配置及当前架构记录；历史 evidence 和 `.harness/runs/` 保留原记录。其他 Server 模块的文件名保持原状。AGENTS.md 已声明 Server TypeScript 文件使用 kebab-case，并明确现有未迁移模块暂不批量改名。

再次使用独立临时 Git index/object directory，按“Routing 领域迁移 → 领域文件命名统一”两步候选提交核验：17 个已提交的 Memory 来源文件及上批 Routing 的 14 个来源文件，共 31 个文件，原提交链缺失数为 0。RoutingService 仍可追溯原 8 次提交。候选验证阶段没有创建真实提交或修改项目 Git 索引；正式交付时按两批提交执行。

Routing 领域迁移已提交为 `04b19e5`，本轮命名调整作为后续独立提交。将两批合并时，Routing 的 `index.ts` 同时更换目录、导出内容和内部路径，默认 rename detection 可能不跟踪；分两步提交的默认 `git log --follow` 已验证可追溯。

命名调整后的 Memory、Routing 与架构测试共 158 项通过（JSON reporter，exit 0）；Server typecheck、Server/agent-eval build、Electron server bundle、server ESLint、本批 TS/配置文件 Prettier check 和 git diff --check 通过。
