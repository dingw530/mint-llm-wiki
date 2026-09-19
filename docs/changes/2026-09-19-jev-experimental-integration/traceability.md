# 追溯总览

变更名称：2026-09-19-jev-experimental-integration
状态：已完成
完成日期：2026-09-19

## US / FP / BR / AC → DS → TP

| 需求          | 关联设计   | 关联验收                                                               | 关联任务                        |
| ------------- | ---------- | ---------------------------------------------------------------------- | ------------------------------- |
| US-001 / FP-003 | DS-001、DS-002、DS-003、DS-010 | AC-004、AC-005、AC-006、AC-010                    | TP-002、TP-006                  |
| US-002 / FP-004 | DS-001、DS-004、DS-009、DS-010 | AC-007、AC-008、AC-009、AC-011、AC-012            | TP-003、TP-006                  |
| US-003 / FP-002 | DS-006、DS-007            | AC-002、AC-003                                                          | TP-004、TP-005、TP-006          |
| US-001 / US-002 / FP-001 | DS-007、DS-009 | AC-001、AC-002                                                 | TP-004、TP-005、TP-006          |
| US-004 / FP-005 | DS-003、DS-005、DS-008    | AC-010、AC-012、AC-013                                                  | TP-001、TP-003、TP-004、TP-006  |
| BR-001~BR-008  | DS-001~DS-010 | AC-001~AC-013                                                          | TP-001~TP-006                   |
| NF（无迁移 / 声明式端点） | DS-007、DS-010 | AC-013                                                    | TP-004、TP-006                  |

## TP 状态

| TP     | 关联设计          | 关联验收                                        | 状态   |
| ------ | ----------------- | ----------------------------------------------- | ------ |
| TP-001 | DS-005、DS-009    | AC-005、AC-010                                  | 已完成 |
| TP-002 | DS-001~DS-003     | AC-004、AC-005、AC-006、AC-010                  | 已完成 |
| TP-003 | DS-001、DS-004、DS-008、DS-010 | AC-007、AC-008、AC-009、AC-011、AC-012 | 已完成 |
| TP-004 | DS-006、DS-007、DS-010 | AC-001、AC-002、AC-011、AC-013             | 已完成 |
| TP-005 | DS-007、DS-009    | AC-001、AC-002、AC-003                          | 已完成 |
| TP-006 | 全部              | AC-001~AC-013                                   | 已完成 |

## 执行记录

- 初始状态：SDD 三件套与追溯矩阵已建立，Harness inspect 已通过（AC-001~013 / DS-001~010 / TP-001~006 全部解析成功）。
- TP-006：完整 Harness 验证。首次 `harness:verify` 的 `unit` 探针失败 6 项，经"HEAD 基线同 runner 对照"定位为本次新增 Jev 测试的 `fetch` 全局 stub 泄漏（见偏差表），修复后 `node scripts/test-runner.mjs` 全量 935 项 0 失败。浏览器场景 `jev-experimental-settings-defaults`(AC-001)、`jev-connection-test`(AC-003)、`jev-settings-persisted`(AC-002) 全部通过。期间修正两处场景断言：设计系统对 `label` 施加 `text-transform: uppercase`，`innerText` 返回大写形式，改为基于角色与 DOM 文本的定位；"测试中" 瞬态在 mock 环境下属竞态，改由组件级测试 `JevSettingsCard.test.tsx` 覆盖（5 项）。
- TP-001：新增 `server/services/jev/{types,jevClient,questions,config}.ts` 与两个测试文件；`callJev` 判别联合返回值、总预算 3000ms、429/529 退避、未配 Key 不发请求；`parseJevAnswers` 无类型断言。`memoryService` 导出 `CATEGORY_ORDER` 供分类一致性断言使用。验证：`npx vitest run services/jev/__tests__` 32 passed；`npx tsc --noEmit` 通过；`npx prettier --check services/jev/` 通过。
- TP-005：新增 `JevSettingsCard.tsx` 与 `jevForm.ts`（纯函数表单映射 + 单测）；`ExperimentalPanel` 挂载卡片；`Settings.tsx` 用单个 `jev` 状态对象并在保存时并入 `toJevSettingsInput`；同步客户端类型镜像、`services/api/settings.ts` 与 barrel、`electron/preload.js`，并由构建脚本重新生成 `electron/endpoints-manifest.json`（仅新增 14 行）。阈值输入使用原生 `input type=number step=0.05`（`NumberInput` 只支持整数）。验证：客户端 `npx tsc --noEmit` 通过；`npx vitest run` 21 文件 77 测试通过；`npx prettier --write` 后无格式问题。
- TP-004：`settingsService` 新增 `getJevSettings` / `getVisibleJevSettings` / `applyJevSettings` 与 `DEFAULT_JEV_*`、`clampInt` / `clampScore` / `safeDecrypt`；`save()` 接入 Jev 字段（非密钥全量落默认值、密钥仅在新值时加密写入）；新增 `jevConnectionService.testJevConnection`；`endpoints/definitions/settings.ts` 增加 typeof 白名单、`validateJevSettings` 校验与 `settings:testJevConnection` descriptor（挂既有 settings 资源前缀，未新建资源）。验证：`npx vitest run endpoints services/api/__tests__/settingsService services/api/__tests__/jevConnectionService` 全通过（含 `ipcHandlers.test.ts` 的 channel 数组与 `handlers.size` 56→57）。
- TP-002：新增 `server/services/routingProviders/`（types / routingPolicy / legacyRoutingProvider / keywordExactProvider / jevRoutingProvider / defaultRoutingSteps / index）与三个测试文件；`routingService.route()` 决策改走 `resolveRoute`，`keywordMatch` / `llmClassify` 保留签名改为委托，`finalize` 用 `formatRoutingLogMethod` 写审计串，并随 `llmClassifyAgents` 迁移修掉 `clearTimeout` 泄漏。验证：`npx vitest run services/routingProviders/__tests__ services/api/__tests__/routing services/jev/__tests__` 90 passed（含既有 `routing.test.ts` 21 项与 `routingService.test.ts` 13 项——即 Jev 关闭时的逐位一致回归锁）；`npm run test:boundary` 通过；`npx tsc --noEmit` 通过。

## 偏差表

| 日期       | 类型     | TP     | 文件                                        | 原因                                                                                                                                                             | 影响                                          | 后续动作                                                       |
| ---------- | -------- | ------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| 2026-09-19 | 内部重构 | TP-003 | `server/services/api/memoryService.ts`、`server/services/api/__tests__/memoryService.test.ts`、`server/services/__tests__/messageService.test.ts`、`server/services/__tests__/react.test.ts` | 四个文件在 HEAD 均不满足 `prettier --check`（既有风格为紧凑多属性对象字面量，`.prettierrc` 会逐属性展开）。实测 `--write` 产生的无关改动分别为 282 / 179 / 263 / 106 行，远超本次功能改动，违反 AGENTS.md 的 Surgical Changes。新增代码沿用周边既有风格。 | 这些文件仍不通过 `prettier --check`（存量问题，非本次引入；本次新增部分是既有风格的延续） | 另开纯格式化变更统一处理，避免混入功能提交 |
| 2026-09-19 | 内部重构 | TP-002 | `server/services/api/routingService.ts`     | 该文件同样在 HEAD 即不满足 `prettier --check`；本次已整体重写 `route()` 主体，格式化改动与功能改动落在同一批行上，无法拆分。                                       | 无功能影响；顺带修掉 `llmClassify` 的 `clearTimeout` 泄漏 | 无                                                             |
| 2026-09-19 | 设计微调 | TP-002 | `server/services/routingProviders/routingPolicy.ts` | `formatRoutingLogMethod` 只把 `unavailable` 计入审计串，`abstain` / `below-threshold` 不计入，以保证 AC-005 的 `method` 在多步链路下仍为 `jev`。 | `routing_logs.method` 不体现正常回退的中间步；完整轨迹保留在 `RouteResult.attempts` | 无                                                             |
| 2026-09-19 | 缺陷修复 | TP-001~TP-004 | `server/services/jev/__tests__/jevClient.test.ts`、`server/services/routingProviders/__tests__/jevRoutingProvider.test.ts`、`server/services/memoryGateProviders/__tests__/jevMemoryGateProvider.test.ts`、`server/services/api/__tests__/jevConnectionService.test.ts` | 新增测试用 `vi.stubGlobal('fetch')` 但只在 `beforeEach` 清理；最后一个用例的 stub 泄漏到同线程的后续测试文件，使 `images.test.ts` 收到伪造的 529 响应、`lifecycle.integration.test.ts` 的 fetch 不再 reject（全量 6 项失败）。定位方式：在 HEAD 基线跑同一 runner 得 0 失败，据此确认是本次引入的回归而非存量问题。 | 已修复：四个文件补 `afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); })`，全量 935 项 0 失败 | 已在本变更内修复；后续新增 stub 全局的测试需同样在 `afterEach` 恢复 |

### 2026-09-19：Harness run 2026-09-19T09-26-31-129Z-46359

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-19-jev-experimental-integration/2026-09-19T09-26-31-129Z-46359
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, docker-smoke:passed, electron-smoke:passed, claims:PASS
