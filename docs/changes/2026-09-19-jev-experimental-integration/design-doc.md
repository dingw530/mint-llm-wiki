# 设计文档：Jev 实验性接入（路由与记忆分类）

变更标识：`2026-09-19-jev-experimental-integration`

## 背景与目标

见 `product-spec.md`。本设计要解决的核心问题是：把 Jev 接入两条既有链路，**同时保证默认关闭时行为零变化**，并且让"Jev 实现"与"原有实现"互不耦合、可独立回退与灰度。

## 约束

| 约束 | 来源 |
| --- | --- |
| 生产代码禁止 `as any` / `as unknown as T` / `as T` 绕过类型系统 | 项目 AGENTS.md |
| 函数不超过 120 行；循环体 ≥30 行、分支 ≥20 行必须提取为命名函数 | 项目 AGENTS.md |
| 同作用域 ≥3 个 `let` 必须封装为状态对象 | 项目 AGENTS.md |
| 新增方法必须有 JSDoc，参数与返回值标类型 | 项目 AGENTS.md |
| 禁止硬编码，后端常量抽取到对应模块 | 项目 AGENTS.md |
| 禁止直接改数据库 schema，必须走 `migrations/` | 项目 AGENTS.md |
| 新 API 端点必须经 `endpoints/` 声明式注册 | 项目 AGENTS.md |
| 外部 API：Jev 只接受文本；同请求内 question 并行独立；32k token 预算由 state 与 questions 共享；429/529 需指数退避；401/422/429/529 错误码 | TypeSafe 文档 |
| Jev 以英文为训练主语言 | TypeSafe 文档 |

## 方案选项与取舍

### 选项 A：把 Jev 做成第四个 `ApiAdapter`

**否决**。`ApiAdapter`（`server/services/adapters/apiAdapter.ts`）是 messages 导向的：`createModel` / `toModelMessages` / `toModelTools` / `stream` / `call`。Jev 是 `state + questions → answers`，无流式、无工具调用、无多模态、无消息角色语义。塞进去会让三个既有适配器的接口含义变模糊，也会让 Jev 被迫实现一批无意义的空方法。

### 选项 B：全局 `registerJevProvider` 注册表（照搬 `apiAdapter.ts` 的 registry）

**否决**。`apiAdapter.ts` 的 `registry` 是模块级可变 `Map`，测试隔离差——`routingService.test.ts` 必须 `vi.mock` 整个模块才能替换实现；且注册依赖 import 副作用的顺序（唯一触发注册的入口是 `aiProxy.ts`）。可替换分类器需要更好的可测性。

### 选项 C（采纳）：provider + 纯函数 policy + 构造注入

照 `server/services/contextProvider.ts` 的骨架（接口 + `order` + 默认列表 + 可注入参数），配合 `server/services/a2ui/composer.ts` 的构造注入写法。provider 是无状态模块级单例，配置每次由 policy 传入；"选哪些 provider"的逻辑集中在单个工厂函数里。

## 最终决策

### DS-001：两条链路采用 provider 抽象 + 纯函数 policy，实现互不耦合

- 路由：`server/services/routingProviders/`，接口 `AgentRoutingProvider`，policy 为纯函数 `resolveRoute`。
- 记忆：`server/services/memoryGateProviders/`，接口 `MemoryGateProvider`，policy 为纯函数 `evaluateMemoryGate`。
- "原有实现"与"Jev 实现"各自是一个 provider，二者不互相引用；组合顺序由 `createDefaultRoutingSteps` / `DEFAULT_MEMORY_GATE_PROVIDERS` 决定。
- 既有 `RoutingHooks` 保持原样：它的语义是生命周期插桩，与"决策来源"是两回事，混在一起会让 `onRoutingComplete` 有机会改动 provider 结论。

**对应**：AC-004、AC-005、AC-006、AC-007、AC-009

### DS-002：既有 0.6 / 0.8 阈值保留在 legacy provider 内部，跨 provider 门控改用步级阈值

`route()` 现有的三段阈值（`>0.8` 直接用 keyword / `0.6~0.8` 试 LLM / `<0.6` 走 general）**不搬到 policy**。原因：keyword 的 1.0 / 0.9 / 0.6 是"触发词命中强度"，Jev 的 `confidence` 是从 `probabilities` 分布推出的校准值，**两者不在同一标尺上**，塞进同一个阈值是错误建模。

替代方案：

- legacy provider 内部保留完整三段逻辑，低置信时返回 `{agentId:'general', confidence:0.6, method:'fallback'}` 而不是弃权 —— 因此 **Jev 关闭时输出与接入前逐位一致**，可写回归锁测试。
- 跨 provider 门控用**步级 `minConfidence`**：`RoutingStep = { provider, minConfidence }`，每个 provider 用自己的标尺。Jev 步的阈值来自设置项，legacy 步为 0（不门控）。
- `AgentRoutingDecision.confidence` 的 JSDoc 明确写出"语义由 provider 定义，跨 provider 不可直接比较"。

**对应**：AC-004、AC-005、AC-006

### DS-003：降级信号用判别联合返回值，而非异常

```ts
type AgentRoutingOutcome =
  | { kind: 'decision'; decision: AgentRoutingDecision }
  | { kind: 'abstain'; reason: 'no_match' | 'no_candidates' | 'answer_not_a_candidate' }
  | { kind: 'unavailable'; reason: JevFailureReason; message: string };
```

`unavailable` 是**预期内的控制流**（超时、429、未配 Key 全都预期会发生），不是异常。用返回值表达可以让 policy 无需 `try/catch` 就把 `reason` 干净地传进 `RoutingAttempt.reason`，最终写进 `routing_logs.method`。provider 抛出的意外异常由 policy 兜底捕获并降级为 `unavailable/unknown`。

**对应**：AC-006、AC-010

### DS-004：记忆门控的降级是不对称的 —— 仅 `unavailable` 回退，`skip` 是终局

- 路由：`abstain` 与 `unavailable` 都回退到下一步。
- 记忆：**只有 `unavailable` 回退**；`skip` 不回退。

理由：Jev 判定"不值得记忆"之后若再跑 legacy 正则，正则大概率判"值得"，Jev 的门控就完全失效了——那才是真正的推翻决策。只有 Jev 没答上来（网络、配额、未配 Key）才轮到 legacy。该不对称性写入 policy 的 JSDoc 并作为测试断言。

**对应**：AC-007、AC-009

### DS-005：Jev 客户端独立于 `ApiAdapter`，新建 `server/services/jev/`

```
server/services/jev/
├── types.ts       # JevQuestion / JevAnswer / JevFailureReason / JevConfig / JevCallResult
├── jevClient.ts   # callJev / parseJevAnswers / classifyJevStatus
└── questions.ts   # question 与 state 构造器 + 常量
```

- 失败走判别联合：`JevCallResult = { ok: true; answers; latencyMs } | { ok: false; reason; status?; message; latencyMs }`。
- 超时用 `AbortSignal.any([AbortSignal.timeout(remaining), external])`，`MAX_ATTEMPTS = 3`、退避基数 300ms、单次尝试最少 250ms 预算，全部受模块常量 `JEV_TIMEOUT_MS = 3000` 的总墙钟预算约束。429 / 529 才重试，401 / 422 立即失败。
- `parseJevAnswers` 逐层收窄，复用 `server/utils/typeGuards.ts` 的 `isRecord` / `readString` / `readNumber`，**不使用任何 `as`**；单个 key 结构不符只跳过该 key；`confidence` 缺失时取 0（宁可落到 legacy，也不误采信）。导出该函数以便直接对畸形响应做单测。

**对应**：AC-005、AC-010；BR-005

### DS-006：Jev 配置走独立的 `getJevSettings()`，不进 `AiSettings`

`AiSettings` 有 21 个字段、60+ 处消费，`server/services/__tests__/contextProvider.test.ts` 有完整字面量 fixture；且 `getAiSettings()` 有**两个几乎完全重复的 return 分支**，加字段意味着 18 行重复修改。Jev 配置是自包含子系统配置，只被 `jevClient` 与几个 provider 消费，没有理由混进通用 AI 形状。既有先例：`settingsService.getChromaApiKey()` 就是"不属于通用形状的专用出口"。

**对应**：AC-002、AC-013

### DS-007：设置项为 7 个 KV 键，复用现有 `settings:get` / `settings:save`，仅新增一个测试连接端点

| 存储 key | 类型 | 默认 | 加密 | 说明 |
| --- | --- | --- | --- | --- |
| `jevApiUrl` | string | `https://api.typesafe.ai/v1/systemone` | 否 | 可指向自建代理，为中文缓解预留接入点 |
| `jevApiKey` | string | `''` | **是** | 缺失时所有 provider 返回 `not_configured` |
| `jevModel` | string | `jev-latest` | 否 | |
| `jevRoutingEnabled` | boolean | `false` | 否 | 路由子开关 |
| `jevRoutingMinConfidence` | number | `0.5` | 否 | Jev 步的置信度门槛 |
| `jevMemoryEnabled` | boolean | `false` | 否 | 记忆子开关 |
| `jevMemoryGateThreshold` | number | `0.4` | 否 | noul 阈值，**故意偏低**（漏记代价高于多记） |

- 超时（`JEV_TIMEOUT_MS = 3000`）与"关键词精确命中时跳过 Jev"（默认开启）做成模块常量，不进设置界面，以收敛配置面。
- `settings` 表是纯 KV（`db.ts:138-141`），**无需迁移**。
- 新增端点 `settings:testJevConnection`（`POST /test-jev-connection`）挂在**既有 `settings` 资源前缀**下 —— 避免新建资源前缀，从而不必改动 `electron/main.js` 的硬编码前缀数组与 `ipcHandlers.test.ts` 的 resources 数组。descriptor **不设 `ipcServiceRef`**，让 IPC 直接调用 descriptor 的 `service` 函数本身，保留校验包装。

**对应**：AC-001、AC-002、AC-003、AC-013

### DS-008：`messageService` 的记忆门控改为"flush 之后 fire-and-forget"

现有 `isConversationValuable` 是同步正则，卡在 SSE 响应路径上（`messageService.ts:319-326`）。Jev 是网络调用，若原地替换为 `await`，最多会给每条消息的响应结束增加一个超时周期。因此：

1. 把 `deferredSink.flush()` 提前到门控之前（flush 之前的逻辑全是同步的 `persistUiBlocks`，提前无副作用）；
2. 门控改为 `void runMemoryGate(...).catch(...)` 的 fire-and-forget：读设置 → `evaluateMemoryGate` → `recordMemoryGateOutcome` → 命中则 `enqueueMemoryProcessing`。

并发安全：`memoryJobRepo.enqueue` 有 `ON CONFLICT(conversation_id)` 幂等，连发消息只是多花几次约 100ms 的 Jev 调用，无正确性问题。

**对应**：AC-012

### DS-009：中文准确率的应对策略

| 措施 | 说明 |
| --- | --- |
| 指令英文、数据中文 | 所有 `instructions` 与 `criteria` 描述使用英文；`state` 保留中文原文。模型用英文推理，中文只作为待判断的数据。 |
| 选项 key 全 ASCII | 记忆分类直接复用既有 ASCII slug（`personal` / `preference` / `feedback` / `project` / `goal` / `general`）；路由选项是 `general` + `a1` / `a2` / …，中文 Agent 名与描述放进 state 的候选名册。返回的 `choice` 必须命中映射表，否则 `abstain('answer_not_a_candidate')` —— 不需要任何文本解析，也不怕模型回中文名。 |
| score 用有序英文档位 | `trivial` / `minor` / `moderate` / `important` / `critical`，代码按下标加权，不做字符串匹配。 |
| `jevApiUrl` 可配置 | 为将来"翻译代理 + 答案回映射"预留唯一接入点，本期不实现代理。 |
| 降级方向本身是缓解 | 任何弃权或失败都回退中文原生的既有实现，最坏结果等于当前行为。 |
| 可测量 | `routing_logs.method` 复合串 + `memory_events` 的 `GATE` 行 + Jev 自报 `confidence`，足以事后量化中文场景的弃权率与低置信率。 |

**对应**：AC-005、AC-006、AC-010

### DS-010：审计落点无需数据库迁移

- 路由：`routing_logs.method` 为无约束 TEXT（`db.ts:208-221`），当前无 UI 消费方（只有 `routing-logs:list` 端点）。用 `formatRoutingLogMethod(attempts, effective)` 压成审计串，如 `jev`、`keyword`、`jev_unavailable:rate_limited>keyword`、`fallback`。格式作为契约写入该函数 JSDoc。
- 记忆：写 `memory_events`，`action: 'GATE'`，`status` 复用现成三态（命中 `applied` / 跳过 `noop` / Jev 不可用 `failed` + `errorCode: 'jev_gate_' + reason`）。已核对表结构（`migrations/index.ts:542-556`），`action` / `status` / `error_code` 均无约束；**`subject` 是 NOT NULL 必须传值**。整个写入包 `try/catch`，审计失败不影响主流程。

**对应**：AC-010、AC-011、AC-013

## 详细设计

### 路由链路

```text
messageService.ts:216 ──► routingService.route()
                            └─ resolveRoute(input, steps, config)        ← 纯函数 policy
                                 ├─ [0] keywordExactProvider  （精确命中 1.0 时短路）
                                 ├─ [1] jevRoutingProvider     （Jev 开启时）
                                 └─ [2] legacyRoutingProvider  （永远兜底）
```

`resolveRoute` 行为表（即降级契约）：

| provider 返回 | confidence vs 门槛 | 动作 |
| --- | --- | --- |
| `decision` | `>=` | 立即返回并采信 |
| `decision` | `<` | 记 `below-threshold`，继续下一步 |
| `abstain` / `unavailable` | — | 记 `abstain` / `unavailable`，继续下一步 |
| 抛异常 | — | 当作 `unavailable/unknown`，继续下一步 |
| 步用尽 | — | `{agentId:'general', confidence:0, method:'fallback', attempts}` |

`routingService.ts` 的改动边界：`RouteResult` 的 `method` 收窄为 `RouteMethod`、新增 `attempts`；`keywordMatch` 与 `llmClassify` **保留方法名与签名**（现有测试直接调用它们），函数体改为委托到 `legacyRoutingProvider`；`route()` 内的 keyword/llm 分支块替换为一次 `resolveRoute`；新增私有 `resolveWithProviders` 读取实验设置并组步，**包 `try/catch`，异常时退回纯 legacy 步**。

Jev 路由的 question 设计（一次请求一问，Speculative Fan-Out 用于记忆侧）：

```ts
{ agent: { type: 'choice',
  instructions: 'Pick the single agent best suited to answer the user message...',
  criteria: { general: 'General-purpose assistant', a1: '<英文 gloss + 原名>', ... } } }
```

### 记忆链路

```text
messageService.ts:320 ──► evaluateMemoryGate(input, config)              ← 纯函数 policy
                            ├─ [0] jevMemoryGateProvider （Jev 开启时）
                            └─ [1] legacyMemoryGateProvider（仅 Jev 不可用时）
```

Jev 记忆门控在**一次请求内问四个问题**（文档明确同请求内多问并行且几乎不增加延迟）：

| question key | 类型 | criteria |
| --- | --- | --- |
| `worth` | noul | 是否值得作为长期记忆 |
| `category` | choice | 六个既有 ASCII slug |
| `importance` | score | 有序英文档位，≥2 档 |
| `action` | choice | `ADD` / `UPDATE` / `NOOP` / `DELETE`，本期仅用于审计 |

state 截断上限：路由 2000 字符、记忆 12000 字符（与 questions 共享 32k token 预算的保守切分）。

`memoryService.ts` 的改动边界：导出 `CATEGORY_ORDER` 与 `CATEGORY_LABELS`；`GREETING_SET` / `SELF_REF_PATTERNS` / `isConversationValuable` 搬到 legacy provider 后**再导出**（保住 `endpoints/__tests__/memory.test.ts` 与 `memoryService.test.ts` 的既有导入路径）；新增 `recordMemoryGateOutcome`。`performExtraction` 本期不动。

### 设置与前端

```text
server/types.ts              JevSettings（新增）；SettingsInput / VisibleSettings 加字段；AiSettings 不动
server/services/api/
  settingsService.ts         DEFAULT_JEV_* 常量、getJevSettings()、applyJevSettings()、clampScore / safeDecrypt
  jevConnectionService.ts    testJevConnection()（新增，照 vectorConnectionService 范式）
server/endpoints/definitions/settings.ts
                             toSettingsInput 加 typeof 守卫；saveSettings 加校验；新增 testJevConnection descriptor
client/src/features/settings/components/
  JevSettingsCard.tsx        （新增）Jev 配置卡片，必须独立组件以守住 ExperimentalPanel 的 120 行上限
  jevForm.ts                 （新增）JevFormState + createJevFormState + toJevSettingsInput（纯函数）
  ExperimentalPanel.tsx      抽掉 Jev 区块，改为挂载 <JevSettingsCard />
  Settings.tsx               单个 jev 状态对象（不是 7 个散装 useState）；getSettings 回填；handleSave 合并
```

- 前端阈值输入**不能用 `NumberInput`** —— 已核对 `client/src/shared/components/NumberInput.tsx:27` 使用 `parseInt`，只支持整数。阈值改用 `<input type="number" step="0.05" min="0" max="1">`。
- boolean 开关使用既有 `div.mode-toggle` 按钮组样板（`GeneralTab.tsx:213-232`）。
- CSS 全部复用 `.experimental-settings-card` / `.connection-test-row` / `.connection-test-button` / `.connection-test-result.{success,error,testing}` / `.form-warning` / `.mode-toggle`，不新增样式文件。
- `experimental` tab 已共享底部保存按钮，保存链路免费。
- `electron/preload.js` 加一行桥接；`client/src/types/index.ts` 加 `ElectronAPI` 签名与字段镜像；`electron/endpoints-manifest.json` 由构建脚本重新生成，不手改。

## 影响与风险

| 影响面 | 说明 |
| --- | --- |
| 存量行为 | 两个开关默认关闭；`legacyRoutingProvider` 保留原有阈值逻辑，Jev 关闭时 `route()` 输出与接入前逐位一致（由回归锁测试证明）。 |
| `routing_logs.method` | 语义从枚举值扩展为可能带失败原因的复合串。列为无约束 TEXT，无 UI 消费方。 |
| 设置保存 | 全量覆盖语义不变；旧客户端保存会把 Jev 开关重置为关闭，方向安全。 |
| 性能 | 关键词精确命中时短路 Jev；记忆门控异步化，不延长响应。 |
| 并发 | 连发消息会并发触发多次 Jev 门控调用，入队幂等保证正确性。 |
| 测试 | `ipcHandlers.test.ts` 的 channel 数组与 `handlers.size`、`messageService.test.ts` / `react.test.ts` 的 mock 工厂需同步更新。 |

## 发布验证

1. `cd server && npm test` —— 全量单元测试，重点确认回归锁与降级矩阵。
2. `npx prettier --check <修改文件>` 与 `git diff --check`。
3. `npm run build` —— TypeScript 编译通过且 `electron/endpoints-manifest.json` 含 `settings:testJevConnection`。
4. `npm run harness:inspect` / `harness:verify` —— 按 AC 聚合证据。
5. `npm run dev` 后浏览器场景验证设置界面交互闭环。
6. 真实 Jev Key 手验：正常 Key 通过测试连接；错误 Key 静默回退且审计可查。

## 验收证据矩阵

| AC | 预期行为 | 实现位置 | 验证方式 | 证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| AC-001 | 实验性功能显示 Jev 配置区，两个子开关默认关闭 | `JevSettingsCard.tsx` / `ExperimentalPanel.tsx` / `settingsService.get()` | browser | `browser-ac` 场景 `jev-experimental-settings` | PASS |
| AC-002 | 保存后回显，Key 掩码且留空不覆盖 | `settingsService.get/save` / `jevForm.ts` | unit + integration | `unit`（jevForm、settingsService）、`boundary` | PASS |
| AC-003 | 测试连接用当前表单值，不写入设置 | `jevConnectionService.ts` / `settings:testJevConnection` | browser | `browser-ac` 场景 `jev-connection-test` | PASS |
| AC-004 | Jev 关闭时路由输出逐位一致 | `legacyRoutingProvider.ts` / `routingPolicy.ts` | unit | `unit`（legacyRoutingProvider 回归锁） | PASS |
| AC-005 | 高置信 choice 被采信，method 记 `jev` | `jevRoutingProvider.ts` / `routingService.finalize` | unit + integration | `unit`（routingPolicy、jevRoutingProvider） | PASS |
| AC-006 | 低置信/弃权回退原有路由并可区分来源 | `routingPolicy.ts` | unit | `unit`（routingPolicy 降级矩阵） | PASS |
| AC-007 | Jev 判跳过时不入队且不调用 legacy | `jevMemoryGateProvider.ts` / `memoryGatePolicy.ts` | unit | `unit`（memoryGatePolicy 不对称断言） | PASS |
| AC-008 | Jev 判命中时按原路径入队提取 | `memoryGatePolicy.ts` / `messageService.runMemoryGate` | integration | `unit` + `boundary` | PASS |
| AC-009 | Jev 不可用时回退 legacy，结果与接入前一致 | `memoryGatePolicy.ts` / `legacyMemoryGateProvider.ts` | unit | `unit`（memoryGatePolicy） | PASS |
| AC-010 | 失败静默回退不中断对话，原因入库 | `jevClient.ts` / `routingPolicy.formatRoutingLogMethod` | unit + integration | `unit`（jevClient、routingPolicy） | PASS |
| AC-011 | 门控结果写 `memory_events` 可区分三态 | `memoryService.recordMemoryGateOutcome` | unit | `unit`（recordMemoryGateOutcome） | PASS |
| AC-012 | 门控在 flush 后异步执行 | `messageService.scheduleMemoryExtraction` | unit + static | `unit`（messageService） | PASS |
| AC-013 | 无迁移；端点声明式注册，IPC 与 HTTP 双通道可达 | `endpoints/definitions/settings.ts` / `ipcHandlers` | integration | `unit`（ipcHandlers channel 断言）+ `boundary` | PASS |

> 偏差记录见 `traceability.md`。
