# 执行计划：Jev 实验性接入（路由与记忆分类）

变更标识：`2026-09-19-jev-experimental-integration`

## 完成定义

1. 两条链路在 Jev 关闭时行为与接入前一致，在 Jev 开启时按 Jev 结果决策，在 Jev 不可用时静默回退。
2. 设置「实验性功能」可开关与配置 Jev，并可测试连接。
3. 所有 AC 达到 `verification-plan.json` 声明的证据等级，无 FAIL / UNVERIFIED / BLOCKED。

## 范围

`server/services/jev/`、`server/services/routingProviders/`、`server/services/memoryGateProviders/`、`server/services/api/{routingService,memoryService,settingsService,jevConnectionService}.ts`、`server/services/messageService.ts`、`server/types.ts`、`server/endpoints/definitions/settings.ts`、`client/src/features/settings/`、`client/src/services/api/`、`client/src/types/index.ts`、`electron/preload.js`、`electron/endpoints-manifest.json`（重新生成）。

## 前置条件

- Node 版本与 `server/package.json` 的 `engines` 一致；`better-sqlite3` 原生模块可用（否则先 `npm run rebuild:sqlite -w mint-server`）。
- `npm run harness:test` 通过。
- 浏览器场景需要先启动 `npm run dev`，并使用外部 `playwright-cli`。
- 真实 Jev API Key 仅用于人工端到端验证，不写入仓库与测试。

## TP 总览

| TP     | 阶段任务                        | 状态   |
| ------ | ------------------------------- | ------ |
| TP-001 | Jev 客户端与 question 构造      | 已完成 |
| TP-002 | 路由 provider 抽象与链路改造    | 已完成 |
| TP-003 | 记忆门控 provider 与异步化改造  | 已完成 |
| TP-004 | 设置 schema 与连接测试端点      | 已完成 |
| TP-005 | 设置界面 Jev 配置区             | 已完成 |
| TP-006 | 验证与证据回写                  | 已完成 |

## 阶段任务

### TP-001 Jev 客户端与 question 构造

- 新建 `server/services/jev/{types,jevClient,questions}.ts`（DS-005）。
- `callJev`：总墙钟预算、429/529 指数退避、错误码映射、判别联合返回值，未配置 Key 时不发请求。
- `parseJevAnswers`：逐层收窄，不使用 `as`，单 key 非法不影响其他 key。
- `questions.ts`：路由与记忆门控的 question / state 构造器、ASCII 选项 key、state 截断上限（DS-009）。
- 单测覆盖畸形响应、错误码映射、超时、退避预算。

产出：`server/services/jev/*`、`server/services/jev/__tests__/*`

### TP-002 路由 provider 抽象与链路改造

- 新建 `server/services/routingProviders/`：`types` / `routingPolicy` / `legacyRoutingProvider` / `jevRoutingProvider` / `keywordExactProvider` / `defaultRoutingSteps` / `index`（DS-001、DS-002、DS-003）。
- `routingService.ts`：`route()` 主体换成 `resolveRoute`；`keywordMatch` 与 `llmClassify` 保留签名改为委托；`finalize` 用 `formatRoutingLogMethod`；顺手修 `clearTimeout` 泄漏。
- 回归锁测试：Jev 关闭时六档 confidence 输出与接入前逐位一致。

产出：`server/services/routingProviders/*`、`server/services/api/routingService.ts`

### TP-003 记忆门控 provider 与异步化改造

- 新建 `server/services/memoryGateProviders/`：`types` / `legacyMemoryGateProvider` / `jevMemoryGateProvider` / `memoryGatePolicy` / `index`（DS-001、DS-004）。
- `memoryService.ts`：导出 `CATEGORY_ORDER` / `CATEGORY_LABELS`；`isConversationValuable` 搬迁后**再导出**；新增 `recordMemoryGateOutcome`（DS-010）。
- `messageService.ts`：`flush()` 提前 + `scheduleMemoryExtraction` fire-and-forget（DS-008）。
- 测试断言不对称降级：Jev `skip` 时 legacy 未被调用。

产出：`server/services/memoryGateProviders/*`、`server/services/api/memoryService.ts`、`server/services/messageService.ts`

### TP-004 设置 schema 与连接测试端点

- `server/types.ts`：新增 `JevSettings`；`SettingsInput` / `VisibleSettings` 加字段；`AiSettings` 不动（DS-006）。
- `settingsService.ts`：`DEFAULT_JEV_*`、`getJevSettings()`、`applyJevSettings()`、`clampScore` / `safeDecrypt`（DS-007）。
- 新增 `server/services/api/jevConnectionService.ts`。
- `endpoints/definitions/settings.ts`：`toSettingsInput` 守卫、`saveSettings` 校验、新增 `settings:testJevConnection` descriptor。
- 同步 `ipcHandlers.test.ts` 的 channel 数组与 `handlers.size`。

产出：`server/types.ts`、`server/services/api/settingsService.ts`、`server/services/api/jevConnectionService.ts`、`server/endpoints/definitions/settings.ts`

### TP-005 设置界面 Jev 配置区

- 新建 `JevSettingsCard.tsx`、`jevForm.ts`；`ExperimentalPanel.tsx` 挂载卡片；`Settings.tsx` 单状态对象与保存合并。
- 同步 `client/src/types/index.ts`、`client/src/services/api/{settings.ts,api.ts}`、`electron/preload.js`、重新生成 `electron/endpoints-manifest.json`。
- 阈值输入使用 `<input type="number" step="0.05">`，不使用只支持整数的 `NumberInput`；开关使用既有 `div.mode-toggle`。

产出：`client/src/features/settings/components/*`、`client/src/types/index.ts`、`client/src/services/api/*`、`electron/preload.js`

### TP-006 验证与证据回写

- 运行 `npm run harness:verify -- --change 2026-09-19-jev-experimental-integration`。
- 启动 `npm run dev` 后运行浏览器场景。
- `--writeback` 回写执行记录并更新 traceability。

产出：`.harness/runs/<change-id>/<run-id>/`、traceability 完成状态

## 风险与依赖

| 项 | 处理 |
| --- | --- |
| Jev 中文准确率未经验证 | 通过审计数据量化弃权率；不在本次变更中承诺中文效果指标 |
| `routing_logs.method` 复合串 | 列为无约束 TEXT，当前无 UI 消费方 |
| 全量 Harness 检查含 docker / electron smoke | 环境不满足时按 BLOCKED 记录，不修改检查配置绕过 |
| 既有 `routingService.test.ts` 的 mock 形状过时 | 本 TP 范围内收敛为最小 `{ call }` 形状 |

## 验证方式

| 阶段 | 命令 |
| --- | --- |
| 局部（TP-001~004） | `cd server && npx vitest run <相关测试文件>` |
| 局部（TP-005） | 客户端类型检查与 `npx prettier --check <修改文件>` |
| 全量单测 | `cd server && npm test` |
| Harness | `npm run harness:inspect -- --change 2026-09-19-jev-experimental-integration`、`npm run harness:verify -- --change 2026-09-19-jev-experimental-integration` |
| 浏览器 | `npm run dev` 后 `npm run harness:browser -- --change 2026-09-19-jev-experimental-integration` |
| 构建 | `npm run build`（含 manifest 重新生成） |
| 人工端到端 | 真实 Jev Key：测试连接成功；错误 Key：静默回退且审计可见 |

## 验收证据矩阵

见 `design-doc.md` 的「验收证据矩阵」与 `verification-plan.json`。每条 AC 的 `requiredEvidence` 与 `invariants` 以 `verification-plan.json` 为准。

### 2026-09-19：Harness run 2026-09-19T09-26-31-129Z-46359

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-19-jev-experimental-integration/2026-09-19T09-26-31-129Z-46359
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, docker-smoke:passed, electron-smoke:passed, claims:PASS
