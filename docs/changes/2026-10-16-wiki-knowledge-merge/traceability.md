# 追溯总览：Wiki 知识页增量合并

## 变更状态

| 属性     | 值                              |
| -------- | ------------------------------- |
| 变更     | 2026-10-16-wiki-knowledge-merge |
| 当前阶段 | 已完成                          |
| 开始日期 | 2026-10-16                      |
| 最近更新 | 2026-10-17                      |

## 需求到设计到执行追溯

| 需求                                       | 设计       | 执行任务       | 当前证据状态                                                     |
| ------------------------------------------ | ---------- | -------------- | ---------------------------------------------------------------- |
| US-001，BR-001/002/007/011，AC-001/005/006 | DS-001/004 | TP-002/004     | PASS：wiki-identity-integration                                  |
| US-002，BR-003/004/010，AC-002/003/004/008 | DS-002/003 | TP-001/003/004 | PASS：provider、settings API 与 browser AC                       |
| US-003，BR-005/006/009，AC-002/003/004/005 | DS-002/005 | TP-001/002/004 | PASS：保守门控、候选路径白名单、内容保留测试                     |
| BR-008，AC-006/007                         | DS-004/005 | TP-002/004     | PASS：单目标聚合与跨存储 integration                             |
| US-001，BR-001/012，AC-009                 | DS-001/006 | TP-005         | PASS：逐标题/alias Top‑5 召回及按路径去重                        |
| US-004，BR-013—019，AC-010—017             | DS-007—009 | TP-006—008     | PASS：wiki_merge tool、跨存储 integration、审批与失败回滚 probes |

## TP 执行记录

| TP     | 当前状态 | 产出文件                                                                              | 验证结果                                                                                           | 备注                                                             |
| ------ | -------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| TP-001 | 已完成   | Wiki domain coordinator/LLM provider、Jev infrastructure provider                     | 12 个 resolver/provider 定向测试、mint-server typecheck 通过                                       | Jev valid-uncertain 不触发 LLM；禁用/不可用时才回退              |
| TP-002 | 已完成   | Wiki compiler、ingestion、`wiki-content.ts` alias 编解码与 tests                      | compiler/content 定向测试、真实 Wiki integration test、typecheck 通过                              | GitNexus 报 CRITICAL，源码调用点确认后按窄范围修改               |
| TP-003 | 已完成   | Jev settings API/UI 与 tests                                                          | settings service、endpoint、client tests 和 typecheck 通过                                         | 新开关默认关闭                                                   |
| TP-004 | 已完成   | identity/content/compiler/integration tests、browser scenario                         | Harness run 2026-10-16T10-04-42-328Z-58923：AC-001…AC-008 PASS                                     | runner 与 domain boundary 问题均已修复                           |
| TP-005 | 已完成   | Wiki compiler 候选召回、定向测试与追溯更新                                            | compiler 18/18；typecheck；Harness `2026-10-17T14-38-58-098Z-91204`：AC‑009 PASS                   | 每个 query Top‑5、保留 ≥0.75 候选、按路径去重                    |
| TP-006 | 已完成   | `wiki_merge` tool、registry/catalog 接入、页面 resolver service                       | 服务端 typecheck 通过；tool tests 3/3 通过                                                         | 工具要求审批，重试安全设为 never；不同/不确定时拒绝合并          |
| TP-007 | 已完成   | merge service、revision snapshot、lifecycle/Claims、manifest/index、graph/search 更新 | Wiki merge integration 1/1 通过                                                                    | 源页在修订快照落盘及更新成功后删除；跨存储异常时保留源文件       |
| TP-008 | 已完成   | tool schema 与多存储 integration tests、Harness evidence                              | Harness `2026-10-17T15-33-33-898Z-32242`：AC-001…AC-017 PASS；typecheck、Prettier、diff check 通过 | AC-008 browser 证据复用成功 run `2026-10-17T14-38-58-098Z-91204` |

## 验证与 Harness 证据

- 浏览器场景：AC-008 PASS；其他 AC 不适用。
- 验证计划：`verification-plan.json`。
- 证据目录：`.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T10-04-42-328Z-58923`。
- 当前 AC 聚合：AC-001 至 AC-009 全部 PASS。
- 候选召回 Harness 证据：`.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-17T14-38-58-098Z-91204`。

## 偏差记录

| 日期       | 类型     | TP     | 文件                           | 原因                                                                     | 影响                                                                               | 后续动作                                             |
| ---------- | -------- | ------ | ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 2026-10-16 | fix      | TP-004 | `scripts/test-runner.mjs`      | 从 `apps/server` 启动时 wrapper/Vitest 路径少退一级，未生成 JSON 报告    | 测试 runner 无法执行 unit 探针；未影响产品运行时                                   | 修正为项目根绝对路径并补全错误输出，重新运行 Harness |
| 2026-10-16 | refactor | TP-001 | Jev Wiki identity provider     | domain boundary 测试禁止 `domains/wiki` 直接依赖 `infrastructure/ai/jev` | Jev provider 移到 infrastructure，由 application composition 注入 domain interface | 重新运行 domain boundary 与 integration tests        |
| 2026-10-16 | refactor | TP-004 | Wiki identity integration test | boundary 检查禁止 scripts 跨域访问 Wiki 和 graph                         | 真实 SQLite/FTS/graph/manifest 探针移入 `domains/wiki/__tests__/`                  | boundary tests 26/26 PASS                            |

## 交接

- 当前进度：TP-001 至 TP-008 已完成；Harness 聚合确认 AC-001 至 AC-017 全部 PASS，完成日期为 2026-10-17。
- 下一步：无。变更完成，Harness 证据目录可复核。
- 已知限制：GitNexus 对 Wiki compiler 核心符号报告 CRITICAL 且结果含索引噪声；源码调用链和 AC integration 证据已补充复核。未使用真实 Jev 服务验证中文身份判断质量。

### 2026-10-16：Harness run 2026-10-16T09-42-17-351Z-50806

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T09-42-17-351Z-50806
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, wiki-identity-provider:passed, wiki-identity-integration:passed, wiki-identity-ingestion-integration:passed, settings-unit:passed, settings-api-integration:passed, client-settings-unit:passed, claims:PASS

### 2026-10-17：候选召回调整 Harness run 2026-10-17T14-34-27-962Z-87058

- 状态：completed
- TP：TP-005
- 证据目录：.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-17T14-34-27-962Z-87058
- 检查结果：browser-ac、wiki-identity-provider、wiki-identity-integration、wiki-identity-ingestion-integration、settings-unit、settings-api-integration、wiki-identity-candidate-recall 全部通过；AC-001 至 AC-009 PASS。

### 2026-10-17：重试记录 2026-10-17T14-37-20-038Z-89772

- 状态：failed（环境重试，后续 run 已成功覆盖）
- 原因：writeback 重跑前已停止本次开发服务器，browser-ac 无法打开 `localhost:5801/chat`。
- 后续：重启开发服务器并运行 `2026-10-17T14-38-58-098Z-91204`，所有专用 probes 和 AC-001 至 AC-009 均通过。

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
