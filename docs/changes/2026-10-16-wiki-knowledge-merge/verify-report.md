# Verify 与 Check-doc 报告：Wiki 知识页增量合并

## 结果

- Harness run：`2026-10-16T10-04-42-328Z-58923`
- Harness 状态：completed
- AC 聚合：AC-001 至 AC-008 全部 PASS
- Check-doc 评级：A。规格、设计、计划、追溯、verification plan 与 browser scenario 的 ID 链路完整。
- 审计方式：主执行代理完成源码与证据自审；没有独立审计代理，不声明独立 L4 审计。

## TP 差异

| TP     | 预期                                                                   | 实际                                                                                                                           | 差异     |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| TP-001 | Jev→LLM resolver、候选白名单、降级策略                                 | Jev provider 在 infrastructure，domain resolver 通过 application 注入；12 个 provider/coordinator 定向测试通过                 | 完全匹配 |
| TP-002 | 精确别名与高置信身份匹配映射到规范路径；按路径合并，拒绝匹配时保留内容 | compiler 精确匹配标题/aliases；相似候选经 Jev/LLM 判断；同目标内容合并一次；路径冲突分配稳定后缀；frontmatter aliases 持续保存 | 完全匹配 |
| TP-003 | Jev 设置独立开关，默认关闭，可保存/回显                                | 设置存储、既有 Settings API、Experimental Jev UI 完成；server/client typecheck 与设置测试通过                                  | 完全匹配 |
| TP-004 | AC unit/integration/browser 证据，Harness writeback                    | 完整 Harness 10 项检查全部通过；API 与浏览器设置闭环通过；HTML/SQLite/FTS/graph/manifest/source integration 通过               | 完全匹配 |

## AC 证据

| AC     | 状态 | 关键证据                                                                                           |
| ------ | ---- | -------------------------------------------------------------------------------------------------- |
| AC-001 | PASS | `wiki-identity-integration`：标题/alias 映射到既有路径并保留旧新正文                               |
| AC-002 | PASS | `wiki-identity-provider`：Jev 高置信唯一候选合并；低置信、多候选不合并                             |
| AC-003 | PASS | `wiki-identity-provider`：Jev 关闭时走 LLM；输出路径必须属于候选集                                 |
| AC-004 | PASS | `wiki-identity-provider`：Jev 不可用时回退 LLM；双 provider 不可用时返回 uncertain                 |
| AC-005 | PASS | `wiki-identity-integration`：身份不同保留新页；已有路径不被覆盖                                    |
| AC-006 | PASS | `wiki-identity-integration`：多条输入映射同一规范页后只写一次且正文不丢失                          |
| AC-007 | PASS | `wiki-identity-ingestion-integration`：原始 Source、manifest、Claim、FTS、图节点和规范页面路径一致 |
| AC-008 | PASS | `settings-unit`、`settings-api-integration`、`browser-ac`：开关默认关闭、保存/回显及浏览器交互通过 |

## 其他验证

- 全量 server unit：1194/1194 通过。
- 定向 client settings 测试：14/14 通过。
- Server 与 client TypeScript typecheck 通过。
- Server coverage 检查与 architecture boundary 检查通过。
- 修改文件 Prettier 检查和 `git diff --check` 通过。
- 无数据库 migration；设置复用现有 settings key-value 表。

## 风险与未验证项

- GitNexus 对 Wiki compiler/shared writer 报 CRITICAL，但图中出现与 Wiki 无关的调用路径。实现前另用源码搜索确认调用点，并以 compiler integration、真实 Wiki ingestion integration、boundary tests 做验证；该风险保留在追溯中，没有通过风险轴降级。
- Jev 判断使用 typed-response 单元测试，没有调用真实 Jev API；中文实体/概念匹配准确率未验证。开关默认关闭，自动合并要求 Jev 高置信且只有一个候选。
- LLM 身份解析和页面合并使用 mock adapter 测试；未对外部模型质量做声明。

## Harness 工件

- Claim 聚合：[`claim-verification.json`](../../../.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T10-04-42-328Z-58923/claim-verification.json)
- 完整 check 定义：[`task.json`](../../../.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T10-04-42-328Z-58923/task.json)
- 浏览器截图：`.harness/runs/2026-10-16-wiki-knowledge-merge/2026-10-16T10-04-42-328Z-58923/browser-ac/browser-jev-wiki-identity-toggle/screenshot.png`

## 2026-10-17 候选召回调整

- 新增 TP-005 / AC-009：每个新页面标题和 alias 独立召回 Top‑5，合并后按路径去重；该规则只影响候选，不改变 Jev→LLM 判断和合并门控。
- Harness run：`2026-10-17T14-38-58-098Z-91204`，专用 checks 7/7 通过，AC-001 至 AC-009 全 PASS。
- 候选召回测试：每个 alias 的 Top‑5 并入候选集，重复规范路径只保留一次；编译器测试 18/18 通过。
- 服务端 typecheck、修改文件 Prettier 检查及 `git diff --check` 通过。
- 风险边界：默认 Harness 配置还尝试运行 Docker smoke；本机 Docker daemon 未运行。变更计划的专用 checks 不依赖 Docker，且完整 unit、browser、coverage、boundary 均已有通过证据。
- writeback 重跑第一次因浏览器服务已停止而失败；随后重启服务并成功完成上述 Harness run，环境失败不影响最终 AC 结果。
