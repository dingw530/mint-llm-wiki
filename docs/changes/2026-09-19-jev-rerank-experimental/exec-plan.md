# 执行计划：Jev 实验性 Wiki Rerank

变更标识：`2026-09-19-jev-rerank-experimental`

## 完成定义

- rerank provider 接口、legacy 实现、Jev 实现和 policy 完成。
- Jev 独立开关默认关闭，配置可保存/读取/回显。
- Jev 失败整次回退 legacy，默认链路无回归。
- 局部测试、Harness inspect/verify、Prettier 和 `git diff --check` 完成。

## TP-001：建立 rerank 契约与 legacy provider

状态：已完成

产出：`server/services/rerank/` 类型、legacy provider、policy、Wiki 搜索接线。

验证：rerank provider 单测、既有 `wikiSearchService` 与 hybrid 单测通过；服务端局部测试 59 个通过。

## TP-002：实现 Jev rerank 与故障回退

状态：已完成

产出：Jev provider、候选 state/question 构造、失败分类与回退测试、结构化日志。

验证：Jev success、malformed、network/timeout、partial failure 全量回退单测通过；未发现 API Key 进入日志的路径。

## TP-003：接入实验性配置

状态：已完成

产出：服务端 `JevSettings`、settings endpoint 映射、前端 Jev 表单和实验开关。

验证：settings service、endpoint、form、组件单测通过；前端全量测试 22 个文件、83 个测试通过；默认关闭和旧字段兼容已覆盖。

## TP-004：Harness 验证与证据回写

状态：进行中

产出：完整 Harness 运行证据、traceability 执行记录、格式与边界检查结果。

验证：`npm run harness:inspect -- --change 2026-09-19-jev-rerank-experimental`、`npm run harness:verify -- --change 2026-09-19-jev-rerank-experimental`。

## 阶段执行记录

- TP-001/TP-002：已完成 rerank 抽象、legacy/Jev provider、policy 回退和 Wiki 搜索接线；服务端类型检查与相关测试通过。
- TP-003：已完成独立 `jevRerankEnabled` 配置、endpoint 映射、表单回显和设置卡片开关；客户端类型检查与 22 个测试文件共 83 个测试通过。
- TP-004：`harness:inspect` 通过；Harness unit 943/943、coverage、boundary、lifecycle integration、signal smoke 和 browser-ac（无场景）通过；Prettier 与 `git diff --check` 通过。Docker smoke 两次受容器内 `npm ci` 下载 Electron 的网络问题影响（一次 `socket hang up`，一次 900 秒超时），因此未将 TP-004 标记为完成，也未执行 writeback。

## 验收证据矩阵

| AC     | 风险   | 不变量                           | 最低证据           | Probe                        |
| ------ | ------ | -------------------------------- | ------------------ | ---------------------------- |
| AC-001 | medium | provider_boundary                | unit               | TP-001 rerank provider tests |
| AC-002 | high   | regression_free, default_off     | integration        | TP-001 Wiki tests            |
| AC-003 | medium | bounded_timeout, candidate_limit | unit               | TP-002 Jev provider tests    |
| AC-004 | high   | rollback, bounded_timeout        | integration        | TP-002 fallback tests        |
| AC-005 | low    | default_off, persistence         | integration        | TP-003 settings/form tests   |
| AC-006 | medium | no_secret_leak, observability    | unit               | TP-002 log assertions        |
| AC-007 | medium | no_schema_change, boundary       | static/integration | TP-004 Harness checks        |

## 允许路径

`server/services/rerank/`、`server/services/api/wikiSearchService.ts`、`server/services/jev/`、`server/services/api/settingsService.ts`、`server/endpoints/definitions/settings.ts`、`server/types.ts`、`client/src/features/settings/`、`client/src/types/`、`docs/changes/2026-09-19-jev-rerank-experimental/`。

保护路径：`.harness/`、`.claude/skills/`、测试配置文件。
