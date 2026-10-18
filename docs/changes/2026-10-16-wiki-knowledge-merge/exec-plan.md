# 执行计划：Wiki 知识页增量合并

## 文档信息

| 属性     | 值                                 |
| -------- | ---------------------------------- |
| 变更标识 | 2026-10-16-wiki-knowledge-merge    |
| 状态     | 已完成                             |
| 关联规格 | [product-spec.md](product-spec.md) |
| 关联设计 | [design-doc.md](design-doc.md)     |

## 完成定义

- AC-001 至 AC-017 均有足够的 Harness evidence，且 invariants 可观察。
- Jev→LLM provider 选择严格遵守 BR-003/004；低置信 Jev 不触发 LLM。
- 合并结果使用唯一 canonical path，旧正文和全部本次新正文均未丢失。
- Settings 与浏览器场景通过；无 DB migration。
- 修改的 TS/TSX/JSON 通过 Prettier 与 `git diff --check`。

## 范围

- Wiki compiler、Wiki identity resolver、Jev settings、settings UI 和对应测试/场景。
- 保留现有工作区未提交的 Agent Runtime、Electron、文档索引改动。
- 不修改 `.claude/skills/`、`.harness/` 核心 runner、外部 Provider 或数据库 schema。

## 任务计划

| TP     | 任务                                                                                 | 关联 DS/AC                     | 允许路径                                                                                                                                                                                                                                                                    | 状态   |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| TP-001 | 新建 Jev→LLM Wiki identity resolver，共享判定类型、候选路径校验与降级日志            | DS-001/002/005；AC-002/003/004 | `apps/server/domains/wiki/`、`apps/server/infrastructure/ai/jev/`                                                                                                                                                                                                           | 已完成 |
| TP-002 | 调整 compiler：候选匹配映射到 canonical page，按目标聚合合并，不再按标题相似删除页面 | DS-001/004；AC-001/005/006/007 | `apps/server/domains/wiki/`、`apps/server/infrastructure/filesystem/`                                                                                                                                                                                                       | 已完成 |
| TP-003 | 增加 Jev Wiki identity 开关及设置 UI 持久化，并将设置注入摄入作业                    | DS-003；AC-008                 | `apps/server/types.ts`、`apps/server/application/settings/`、`apps/server/application/wiki/`、`apps/server/endpoints/definitions/settings.ts`、`apps/client/src/features/settings/`、`apps/client/src/types/`                                                               | 已完成 |
| TP-004 | 补齐 resolver/compiler/settings 集成测试和浏览器验收；运行 Harness 并写回证据        | DS-001—005；AC-001—008         | `apps/server/domains/wiki/__tests__/`、`apps/server/infrastructure/ai/jev/__tests__/`、`apps/server/application/settings/__tests__/`、`apps/client/src/features/settings/components/__tests__/`、`scripts/test-runner.mjs`、`docs/changes/2026-10-16-wiki-knowledge-merge/` | 已完成 |
| TP-005 | 将候选召回改为标题和每个 alias 分别取 Top‑5，再按规范路径去重合并                    | DS-006；AC-009                 | `apps/server/domains/wiki/wiki-compiler.ts`、`apps/server/domains/wiki/__tests__/wiki-compiler.test.ts`、`docs/changes/2026-10-16-wiki-knowledge-merge/`                                                                                                                    | 已完成 |
| TP-006 | 复用候选召回与 resolver，新增 wiki_merge 审批工具及页面合并 service                  | DS-007/009；AC-010/011/012/017 | `apps/server/domains/wiki/`、`apps/server/application/wiki/`、`apps/server/application/tools/wiki/`、`apps/server/bootstrap/`、`apps/server/application/agent-runtime/`                                                                                                     | 已完成 |
| TP-007 | 实现源页快照、内容/链接合并、生命周期/Claims/manifest/graph/search 更新与失败保留    | DS-003/008；AC-013/014/015/016 | `apps/server/domains/wiki/`、`apps/server/infrastructure/filesystem/`、`apps/server/infrastructure/persistence/`、`apps/server/domains/knowledge-graph/`                                                                                                                    | 已完成 |
| TP-008 | 增补 tool 与多存储 integration tests，运行专用 Harness checks 并写回                 | DS-007—009；AC-010—017         | 对应 `__tests__/` 和本变更文档                                                                                                                                                                                                                                              | 已完成 |

## 验证方式

- 局部服务端测试：`cd apps/server && npx vitest run domains/wiki/identity/__tests__/*.test.ts infrastructure/ai/jev/__tests__/wiki-identity-provider.test.ts domains/wiki/__tests__/wiki-compiler.test.ts domains/wiki/__tests__/wiki-identity-merge.integration.test.ts domains/wiki/__tests__/wiki-ingestion-service.test.ts application/settings/__tests__/settings-service.test.ts infrastructure/filesystem/__tests__/wiki-content.test.ts`
- 前端定向测试：`cd apps/client && npx vitest run --config vitest.config.ts src/features/settings/components/__tests__/JevSettingsCard.test.tsx src/features/settings/components/__tests__/jevForm.test.ts`
- 静态检查：`npx prettier --check <本次修改的 TS/TSX/JSON 文件>`、`git diff --check`。
- UI 场景前启动 `npm run dev`，运行 `npm run harness:browser -- --change 2026-10-16-wiki-knowledge-merge`。
- Wiki 页面/文件/SQLite 生命周期/FTS/图谱集成探针：`cd apps/server && npx vitest run domains/wiki/__tests__/wiki-identity-merge.integration.test.ts --poolOptions.threads.singleThread`。
- 完整验证：`npm run harness:verify -- --change 2026-10-16-wiki-knowledge-merge --checks <定向 checks JSON>`；checks 包含 unit、browser-ac、boundary、wiki-identity-provider、wiki-identity-integration、wiki-identity-ingestion-integration、settings-unit、settings-api-integration 与 wiki-identity-candidate-recall，按 AC 证据等级聚合。
- TP-005 候选召回：`cd apps/server && npx vitest run domains/wiki/__tests__/wiki-compiler.test.ts`；静态检查运行 Prettier 与 `git diff --check`。
- TP-005 Harness 聚合：run `2026-10-17T14-38-58-098Z-91204`，候选召回 probe 与 AC-001…AC-009 均 PASS。
- TP-006/TP-007/TP-008 定向验证：`cd apps/server && npx vitest run application/tools/wiki/__tests__/wiki-merge-tool.test.ts agent-runtime/tooling/__tests__/json-schema-policy.test.ts domains/wiki/__tests__/wiki-page-merge.integration.test.ts domains/wiki/__tests__/wiki-compiler.test.ts --poolOptions.threads.singleThread`；再运行 `npx tsc --noEmit -p apps/server/tsconfig.json`、Prettier 与 `git diff --check`。
- `wiki-page-merge.integration.test.ts` 覆盖目标正文、源页快照/删除、生命周期状态、图谱节点、manifest、首页索引和搜索文档；Tool 测试覆盖审批元数据、未审批拒绝和注册 schema。
- 专用 Harness claim aggregation 使用上述 tool 单测和 Wiki merge integration probe；AC-008 的 browser evidence 继续引用既有 run `2026-10-17T14-38-58-098Z-91204`。
- Harness 使用的完整 check 定义和输出：[`task.json`](../../../.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T10-04-42-328Z-58923/task.json) 与同目录 `claim-verification.json`。

## Harness 证据契约

见 [verification-plan.json](verification-plan.json)。UI 设置 AC-008 由设置单元测试和浏览器交互场景共同验证；其余 AC 是纯后端，browser evidence 不适用。

wiki_merge Harness run `2026-10-17T15-33-33-898Z-32242`：AC-001 至 AC-017 全部 PASS；Wiki merge tool、跨存储 integration 和 boundary probes 通过。AC-008 browser evidence 复用此前成功 run `2026-10-17T14-38-58-098Z-91204`，本轮未重启 UI 服务。

## 风险与依赖

- GitNexus 对核心编译函数报告 CRITICAL，但 direct source search 显示 `deduplicatePages` 仅由 `finalizeCompiledPages` 调用，`compileSource` 由两条任务提交路径调用。保留该风险告警，并要求 compiler integration tests 覆盖两条入口。
- Jev 的中文判断准确性未被本变更证明；默认开关关闭，自动合并要求高置信。
- Harness browser 验证依赖可运行 dev server 和外部 `playwright-cli`；若受限环境无法启动服务，AC-008 标记 BLOCKED/UNVERIFIED，不用 mock 冒充浏览器证据。

## 执行记录

### TP-001

- 状态：已完成
- 产出文件：Wiki domain coordinator/LLM provider、`apps/server/infrastructure/ai/jev/wiki-identity-provider.ts` 与定向测试。
- 验证：resolver 定向测试 12/12 通过；`npm run typecheck`（mint-server）通过。
- 问题/偏差：初次类型检查发现 Wiki 文档 JSON helper 类型不适配；改为身份响应专用 JSON parser 后通过。Jev uncertain 是终态，不触发 LLM fallback。

### TP-002

- 状态：已完成
- 产出文件：`apps/server/domains/wiki/wiki-compiler.ts`、`apps/server/domains/wiki/wiki-ingestion-service.ts`、`apps/server/application/wiki/wiki-ingestion-job-service.ts`、`apps/server/infrastructure/filesystem/wiki-content.ts` 与 compiler/content/ingestion tests。
- 验证：compiler/content/resolver 定向测试 43/43 通过；Wiki 页/SQLite lifecycle/FTS/graph/manifest/source 的真实本地 integration smoke 通过；server typecheck 通过。
- 问题/偏差：GitNexus 对核心 compiler symbols 报 CRITICAL 且列出非 Wiki 路径；源码检索确认 `deduplicatePages` 只有一个直接调用点，改变限于编译阶段，并用 compiler 与真实 ingestion smoke 验证。

### TP-003

- 状态：已完成
- 产出文件：Jev settings types/service/API mapping、Jev settings card/form、server/client tests 与浏览器场景。
- 验证：settings service 测试和前端表单/卡片测试通过；Jev settings HTTP endpoint test 5/5 通过；server/client typecheck 通过。
- 问题/偏差：开关默认关闭；旧客户端未传该字段时沿用现有设置全量保存语义，开关回到关闭。

### TP-004

- 状态：已完成
- 产出文件：Wiki identity/compiler integration test、browser scenario、identity/compiler/settings tests。
- 验证：Harness unit 1194/1194、client settings tests 14/14、Jev settings HTTP endpoint tests 5/5、domain boundary 26/26 通过；真实 Wiki ingestion integration 与 browser AC-008 通过。Harness run `2026-10-16T10-04-42-328Z-58923` 中 10 个检查全部通过，AC-001 至 AC-008 全部 PASS。
- 问题/偏差：首轮浏览器断言因同一路径有多次 GET/PUT 而误计数，已改为按 PUT 方法及路径断言，第二轮通过。Harness `unit` 首轮发现 `scripts/test-runner.mjs` 的项目脚本/依赖路径相对 `apps/server` 少退一级；已修正并通过完整 unit runner。Jev 未调用真实外部服务，模型身份判断质量未在本次验证。

### TP-005

- 状态：已完成
- 产出文件：`apps/server/domains/wiki/wiki-compiler.ts`、`apps/server/domains/wiki/__tests__/wiki-compiler.test.ts` 与候选召回 SDD/verification 更新。
- 验证：Wiki compiler 测试 18/18；服务端 typecheck 通过；Prettier 与 `git diff --check` 通过。Harness run `2026-10-17T14-38-58-098Z-91204` 的专用 checks 7/7 通过，AC-001 至 AC-009 全 PASS。另一次默认全量 Harness 的 1195/1195 unit、browser、coverage 和 boundary 通过；默认 Docker smoke 因 Docker daemon 未运行失败，之后按变更计划的专用 checks 完成 claim 聚合。
- 问题/偏差：候选召回按每个去重后的标题/alias query 各取 Top‑5；相似度仍用 Mint 的 Dice 分数下限 0.75；候选按规范路径去重并以最高 query 分数稳定排序。未改变 Jev→LLM 判断门控。
- Harness writeback 首次重跑时开发服务器已停止，browser-ac 失败；重启服务后的 run `2026-10-17T14-38-58-098Z-91204` 通过并完成 writeback，前次环境失败已被成功运行覆盖。

### 2026-10-16：Harness run 2026-10-16T09-42-17-351Z-50806

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T09-42-17-351Z-50806
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, wiki-identity-provider:passed, wiki-identity-integration:passed, wiki-identity-ingestion-integration:passed, settings-unit:passed, settings-api-integration:passed, client-settings-unit:passed, claims:PASS

### 2026-10-16：最终 Harness writeback 2026-10-16T10-04-42-328Z-58923

- 状态：completed
- TP：全部
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T10-04-42-328Z-58923
- 检查结果：unit 1194/1194，browser-ac、coverage、boundary、Wiki provider/compiler/ingestion integration、settings unit/API、client settings 均 passed；AC-001 至 AC-008 PASS。

### 2026-10-17：Harness run 2026-10-17T14-37-20-038Z-89772

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-17T14-37-20-038Z-89772
- 检查结果：browser-ac:failed, claims:FAIL

### 2026-10-17：Harness run 2026-10-17T14-38-58-098Z-91204

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-17T14-38-58-098Z-91204
- 检查结果：browser-ac:passed, wiki-identity-provider:passed, wiki-identity-integration:passed, wiki-identity-ingestion-integration:passed, settings-unit:passed, settings-api-integration:passed, wiki-identity-candidate-recall:passed, claims:PASS

### 2026-10-17：Harness run 2026-10-17T15-29-45-826Z-26815

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-17T15-29-45-826Z-26815
- 检查结果：browser-ac:passed, wiki-identity-provider:passed, wiki-identity-integration:passed, wiki-identity-ingestion-integration:passed, settings-unit:passed, settings-api-integration:passed, wiki-identity-candidate-recall:passed, wiki-merge-tool:passed, wiki-merge-integration:passed, boundary:failed, claims:PASS

### 2026-10-17：Harness run 2026-10-17T15-33-33-898Z-32242

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-17T15-33-33-898Z-32242
- 检查结果：browser-ac:passed, wiki-identity-provider:passed, wiki-identity-integration:passed, wiki-identity-ingestion-integration:passed, settings-unit:passed, settings-api-integration:passed, wiki-identity-candidate-recall:passed, wiki-merge-tool:passed, wiki-merge-integration:passed, boundary:passed, claims:PASS
