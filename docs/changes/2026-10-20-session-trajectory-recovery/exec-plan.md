# 执行计划：会话轨迹持久化与恢复

- 变更：`2026-10-20-session-trajectory-recovery`
- 状态：TP-001 至 TP-008 已验收；TP-009 执行中。
- 本次目标：在既有第一、二期迭代上补齐 Session 权威聊天投影，并移除 Session 事件的常规加解密。
- 前置：核对依赖变更 `2026-10-20-tool-invocation-arguments` 的实际代码与迁移；保留用户现有所有未提交改动。

## 完成定义与实施范围

实现验收需满足 AC-001 至 AC-018 的 requiredEvidence 与全部 invariants，真实重启证据和浏览器交互证据分别存在；不得以 Harness inspect 成功代表实现完成。最新非 Docker Harness 通过 17/17 检查并汇总 18/18 AC claims PASS；Docker smoke 按用户要求跳过。
第一期完成 TP-001 至 TP-004；第二期完成 TP-005 至 TP-008。第一期检查点不是单独前端发布开关，不允许激活日志后绕过语义写入。
允许的生产修改范围在各 TP 中列出；`.harness/`、`.claude/skills/`、测试配置与其他用户改动默认受保护。不自动提交。

## 实施前检查

1. 阅读现行 AGENTS.md、此目录全部文档和依赖变更；刷新 GitNexus 后对每个将修改的函数/类做 impact，报告 HIGH/CRITICAL 与 UNKNOWN。
2. 确认 Node 20.19.4、原生 SQLite ABI、当前迁移序号与可用 dev 端口。
3. 新包和协议作为单独变更范围实施，不把当前工作区已有工具参数代码算作本变更新产出。
4. 将 traceability 状态改为执行中，仅把当前 TP 改为进行中。
5. 新增端点时读取 add-endpoint 技能；未来新增代码注释使用中文 JSDoc。

## 任务总览

| TP     | 阶段 | 任务                                         | 依赖                   | 状态                                      |
| ------ | ---- | -------------------------------------------- | ---------------------- | ----------------------------------------- |
| TP-001 | 一期 | session 事件契约、恢复纯函数、模型与轨迹投影 | 无                     | 已实现并通过 AC claims                    |
| TP-002 | 一期 | SQLite、加密、所有权与旧消息导入             | TP-001                 | 已实现并通过 AC claims                    |
| TP-003 | 一期 | 全执行路径的模型/工具语义记录与检查点        | TP-001、TP-002         | 已实现并通过 AC claims                    |
| TP-004 | 一期 | 冷修复、未知结果和强退窗口                   | TP-002、TP-003         | 已实现并通过 AC claims                    |
| TP-005 | 二期 | 统一普通发送/恢复/审批/重新生成上下文入口    | TP-003、TP-004         | 已实现并通过 AC claims                    |
| TP-006 | 二期 | 轨迹快照、详情、增量与 HTTP/IPC              | TP-001、TP-002、TP-004 | 已实现并通过 AC claims                    |
| TP-007 | 二期 | agent-ui 组件库、独立轨迹面板和宿主接入      | TP-001、TP-006         | 已实现并通过 AC claims                    |
| TP-008 | 二期 | 真实重启、生命周期、浏览器和打包验收         | TP-005、TP-006、TP-007 | 非 Docker 验收通过；Docker 按用户要求跳过 |
| TP-009 | 补充 | Session 权威聊天历史投影与事件明文迁移       | TP-001…TP-008          | 进行中                                    |

## 当前任务

| TP     | 任务                   | 状态   |
| ------ | ---------------------- | ------ |
| TP-009 | 权威历史投影与明文迁移 | 进行中 |

TP-008 已按范围完成。用户要求跳过 Docker；其余默认检查和本变更专用 probes 均通过，18 条 AC claims 全部 PASS。

TP-009 延续原变更目录和编号，不覆盖 TP-001 至 TP-008 的历史验收证据。补充验收目标为 AC-019/020；未完成验证前不得沿用原 18 条 claims 代表新目标已通过。

## TP-009：Session 权威聊天投影与明文迁移

- 关联：DS-002/003/006、AC-010/019/020。
- 修改范围：`packages/session/src/contracts.ts`；Session repository 和 migration 36；普通对话最终 assistant 消息身份；消息读取投影；客户端工具调用 unknown 状态；本变更的验收计划和追溯记录。
- 内容：Session 事件成为聊天与轨迹的权威来源；同一 turn 的中间模型响应和工具过程合并显示，最终回答保留稳定 messageId。前端将持久 A2UI 块合并进 Session 段。`messages` 仅保留兼容、记忆和 A2UI 关联用途。迁移 36 在事务内将旧密文迁移为 `payload_json`，正常读写不再调用加解密。凭据和 Tool Invocation Ledger 加密不变。
- 验收：旧载荷迁移完整且原子；JSON 明文读写；聊天刷新重建 user、assistant、reasoning、tool call/result/unknown；A2UI 通过稳定 messageId 关联；不会重复投影。
- GitNexus：曾有 `getMessages` LOW 与 `decodeEvent` HIGH 的上游影响结果；本轮 CLI refresh/impact 因 GitNexus runner 触发 npm registry 网络请求而失败，未将该结果视作无影响。源码调用点由 `routes/messages.ts` 与 Session `readAll/readPage/readEvent` 确认。

## TP-001：@mint/session

- 关联：DS-001/003/005；AC-001/002/005/008。
- 产出：packages/session 的 package.json、tsconfig、公开 exports、contracts、model-projection、trace-projection、repair 和测试；根 workspaces/lockfile 的必要注册。
- 允许路径：packages/session/、根 package.json 与 package-lock.json；相关既有构建声明须单独记录。
- 内容：明确事件版本、全局 seq、原始参数字符串、assistant Tool Calls 分组、模型有效视图与安全 TraceEntry；repairPlan 只返回追加计划。
- 验证：session-contract；包边界检查、重复输入幂等、乱序/断档拒绝、并行结果配对与防御性副本。
- 产出：packages/session/package.json、tsconfig.json、src/contracts.ts、validation.ts、model-projection.ts、recovery.ts、trace/contracts.ts、trace/projector.ts、src/session.test.ts；根 workspace、lockfile 与 server workspace 声明。
- 验证：@mint/session build 通过；session-contract 11/11；ESM 主入口与 trace 子路径可加载；npm pack --dry-run 确认包只含 dist、README 与 package metadata；Prettier 与 git diff --check 通过。
- AC 证据：probe 已通过，Harness claims 尚未聚合，因此 AC-001 保持 UNVERIFIED。
- 影响分析：GitNexus 刷新于当前工作区；runMigrations risk=CRITICAL（337 节点、62 流程），getDb risk=CRITICAL（410 节点、67 流程）。TP-002 仅追加 migration 35 和新仓库，不修改这两个函数及既有表定义。该图包含未收录分支，仍以真实 SQLite 测试和源码检查为准。

## TP-002：宿主持久化与旧记录

- 关联：DS-002/010；AC-003/009/010/017。
- 产出：apps/server/infrastructure/persistence/conversation-session-repository.ts、migrations/index.ts 的新增迁移、旧消息导入和存储 integration tests、宿主类型适配。
- 允许路径：上述新仓库、migrations/、repositories/messageRepository.ts 及其直接测试、application/conversations/ 的会话删除/迁移入口、现有加密与 Ledger 事务的最小适配。
- 内容：加密载荷、序号分配、原子追加、所有权与 fence、一次性导入、级联删除、messages 兼容投影。不得硬编码迁移编号或生成旧工具结果。
- 验证：session-storage，真实 SQLite rollback、密文原文不可见、不可解密诊断、两次导入相同、事务失败工具正文计数为零。
- 风险：迁移入口与多表事务；改前须单独 impact，备份要求写入发布说明。
- 产出：migration 35、新增 ConversationSessionRepository 及真实 SQLite 集成测试；旧 messages 首次读取时稳定导入，载荷 AES-256-GCM 加密；状态支持完整性、尾部不完整、快照水位和租约 fencing。
- 验证：迁移兼容测试 2/2；会话仓库真实 SQLite tests 8/8；服务端 typecheck 通过；写入回滚、旧消息幂等、密文不可见、错误密钥、分页水位、级联删除及租约过期/栅栏均有断言。
- AC 证据：局部 probes 通过；AC-003/009/010/017 等待完整 Harness claims 聚合，其中 API 权限和执行前 Ledger 同事务仍由后续 TP 覆盖。
- 风险：迁移和数据库初始化调用图为 CRITICAL；本 TP 仅追加 migration 35 和新仓库，未改 runMigrations/getDb 实现。索引的入口与分支有预算截断，另由真实 SQLite probes 补证。

## TP-003：语义写入与检查点

- 关联：DS-003/004；AC-002/003/004/008/018。
- 产出：宿主 session 记录协调器；react-loop-core、ai-proxy、tool-round-engine、tool-execution-service、tool-approval-service 的最小接入；相关 Runtime Port 适配。
- 允许路径：apps/server/agent-runtime/、application/agent-runtime/、application/conversations/ai-proxy.ts、bootstrap/；packages/react-runtime/ 与 tool-runtime/ 只有出现不可替代的 Port 需求时才调整，并记录原因。
- 内容：一轮模型消息只写一次；工具分派和 Ledger claim 同事务；最终模型可见结果先落盘再发起下一请求；上下文贡献及摘要替换记录；取消和拒绝记录不同状态。
- 验证：session-runtime integration、session-crash 的执行前/结果后窗口。每个入口记录工具执行计数、已提交 seq 与下一模型请求列表。
- 实现：普通聊天入口记录用户轮次、系统和检索上下文；ReAct 与 stream 记录工具目录、完整模型响应、分派和模型可见结果；上下文压缩前后的历史替换也持久化。Ledger claim 与 Session dispatch 同 SQLite 事务提交。活审批保留所有权；审批请求、批准、拒绝和到期写入语义日志。运行完成、失败、取消记录不同终态。
- 产出：`runtime-context.ts`、`session-message-adapter.ts`、`react-loop-core.ts`、`tool-round-engine.ts`、`tool-execution-service.ts`、`tool-approval-service.ts`、`ai-proxy.ts`、`message-service.ts`、`session-run-writer.ts` 及相关测试。
- 验证：服务端 typecheck 通过；ReAct、审批服务、审批审计、租约和 message-service 定向测试通过；真实 SQLite 验证消息/轮次事务回滚、Ledger/dispatch 同事务、写入失败阻止工具执行；格式检查与 `git diff --check` 通过。
- AC 证据：TP-003 局部 probe 通过，但集成中的下一模型请求、活跃审批进程与取消行为仍需 Harness 进程证据；AC-002/003/004/008/018 保持 UNVERIFIED。

## TP-004：冷恢复与进程证据

- 关联：DS-005；AC-005/006/015。
- 产出：冷修复服务、现有 agent-run-recovery-service 的 Session 接入、scripts/session-crash-smoke.mjs、进程夹具和 recovery integration tests。
- 允许路径：application/conversations/、application/agent-runtime/agent-run-recovery-service.ts、相关 tests、scripts/session-crash-*、packages/session/repair。
- 内容：有效持有者不修复；失活后新 fence 修复；未知不等于失败；Ledger 成功无结果不重放；确定性 repair eventId；新旧运行血缘。
- 验证：session-recovery + session-crash，独立进程 SIGKILL 后重开同 DB，观察真实文件内容及工具调用计数。
- 必测窗口：assistant 已提交但未分派；分派已提交且副作用前；部分写文件；副作用完成未写结果；结果已提交未开始下一轮；写入拒绝；活运行与两个持有者；恢复两次。
- 状态：已实现，等待 AC 聚合。
- 产出：`conversation-session-recovery-service.ts`、真实 SQLite 恢复服务 tests、`message-service.ts` 冷修复与 Session 投影接入、消息历史适配器对空 assistant tool-call 内容的恢复。
- 局部验证：服务端 typecheck 通过；冷修复服务真实 SQLite tests 3/3、message-service tests 23/23 通过。测试覆盖未知结果和 Ledger succeeded 不重放、未分派调用、过期审批、重复恢复、活租约不修复，以及新问题上下文中的工具调用与合成结果顺序。
- 进程证据：`node scripts/with-node-version.cjs node --import tsx scripts/session-crash-smoke.mjs` 通过。工具调用分派已提交后，独立子进程将目标文件写入第一段并被 SIGKILL；新进程打开同一 DB，将 Ledger `executing` 转为 `outcome_unknown`，追加一次恢复结果，重建原始调用及未知结果；重复恢复不追加第二份结果，文件仍保持部分内容，Ledger attempt 为 1。
- 影响分析：上次可用 GitNexus 报告将 `sendMessageRequest` 标为 HIGH（5 个符号、3 条流程）；当前工作树的 GitNexus 索引标记时间早于本轮修改。尝试运行项目 runner 的 analyze 和 impact 均在 10-15 秒后超时，runner 正等待外部包解析；未将空结果当作无影响。此次只在该入口增加冷修复和历史投影，保留 HIGH 风险提示。
- 进程矩阵扩展：独立子进程分别覆盖模型调用未分派、分派后副作用前、部分写入、Ledger 成功但 Session 结果缺失、工具结果已提交但下一轮未开始、Bash 路径策略拒绝、冷审批过期、活动持有者阻止修复、接管后的旧 fence 写入拒绝，以及跨进程重复恢复。
- 验证：完整 `session-crash-smoke` 通过；所有案例均使用隔离 SQLite 文件和子进程。结果包含 Ledger 状态/attempt、实际文件内容、模型历史状态、审批状态、恢复事件数和 stale-owner 写入拒绝。AC-005/006/015/016 仍需 Harness 聚合与真实服务浏览器证据。

## TP-005：统一会话入口

- 关联：DS-006；AC-007/008/016/018。
- 产出：prepare-conversation-turn.ts（拟定）、message-service 收口、原恢复动作适配、审批与 regenerate 分支、最终回答投影。
- 允许路径：application/conversations/、application/agent-runtime/tool-approval-service.ts、agent-run-recovery-service.ts、repositories/messageRepository.ts、相关 tests。
- 内容：普通输入自动准备历史；显式继续不重发原用户消息；不丢此前成功工具结果；恢复回答落库；当前权限重新校验；新消息不等于旧工具重试授权。
- 验证：session-runtime + session-crash；模型请求捕获中存在早期结果、未知结果和新用户消息，顺序正确；再次打开会话不重复回答。
- 当前进展：普通发送和显式恢复共享 Session 历史投影；恢复动作创建 successor turn，记录 originRunId/actionId/action。恢复按钮先执行 Session 冷修复，再把原工具调用、恢复结果和新的恢复指引交给模型；`continue` 不重放旧调用，`retry` 保持 Ledger success / 缺参数拦截并要求显式确认。恢复回答经统一发送 helper 持久化。
- 实现补充：重新生成仅保留最后一个用户请求前缀；若该请求后已有工具调用或结果，HTTP 预检返回 409。恢复运行保留原调用和结果，并以 successor run 继续，不自动重放旧调用。
- 验证：message-service 测试覆盖恢复历史顺序、普通发送冷修复、重新生成不重复保存用户消息，以及存在工具历史时拒绝重新生成；服务端 typecheck 通过。显式恢复的真实重启和审批继续证据仍待补。AC-007/008/016/018 保持 UNVERIFIED。

## TP-006：API 与 IPC

- 关联：DS-007；AC-010/011/014。
- 产出：trajectory 服务、endpoints/definitions/conversations.ts 的快照与详情 descriptor、client services/api、Electron handler/preload、ElectronAPI 类型和 manifest。
- 允许路径：application/conversations/、endpoints/、client/src/services/api/、client/src/types/、client/src/features/chat/hooks/、electron/ 的端点适配与测试。
- 内容：授权安全预览、显式详情、快照水位、分页、SSE/IPC 取消、游标补拉与去重，订阅先于补发防缺口。
- 验证：session-api integration + session-transport process-smoke；并发提交落在分页/订阅交界时行数不丢不重；HTTP 和 IPC 使用相同夹具。
- 当前进展：轨迹 API 返回逐事件安全 metadata、聚合 entries、runs 摘要和 detail availability 包；快照读取先在无活动租约时冷修复。Web 使用 Last-Event-ID SSE；Electron 在进程内调用同一 stream descriptor，经 IPC 推送并支持取消。
- 验证：轨迹服务测试 3/3；IPC handler 测试 9/9、轨迹 IPC parity 测试 2/2；`session-transport-smoke` 用同一隔离 DB 验证 HTTP/IPC 快照和详情一致、快照/订阅交界补发、Last-Event-ID 去重及取消后停止更新；服务端构建与客户端 typecheck 通过。
- AC-010/011/014 仍需 Harness claim 聚合，状态保持 UNVERIFIED。

## TP-007：@mint/agent-ui 与轨迹面板

- 关联：DS-001/008/009；AC-010/012/013/014。
- 产出：packages/agent-ui/ 全包；AgentTracePanel、内部 toolbar/overview/list/detail；Mint 的 ConversationTraceView、ChatHeader/ChatAreaView 接入、design-token 映射。
- 允许路径：packages/agent-ui/、client/src/features/chat/、client/src/styles/ 的本面板样式、必要 workspace/lockfile/build 声明；不批量改 Mint 其他界面。
- 内容：公开受控组件 props；不导入 host API/store；React peer 依赖；独立样式入口。对话/轨迹页签、三泳道总览、时长/轮次/调用切换、搜索过滤、选中定位、显式详情、完整性/空态/错误/未知状态、键盘与窄屏。
- 验证：session-packages-smoke 的独立 React 宿主与包边界检查；session-ui-integration 的 jsdom 交互；browser-ac 场景、参考截图布局评审、token/主题和不可信文本渲染检查。
- 当前进展：创建 `@mint/agent-ui`，实现 `AgentTracePanel`、三泳道概览、时长/轮次/调用视图、搜索、详情、未知状态和历史不完整提示。Mint 聊天标题提供“对话/轨迹”标签，composer 保持挂载。
- 产出：`packages/agent-ui/`、`ConversationTraceView.tsx`、`trajectory.ts`、ChatHeader/ChatAreaView 接入、Electron preload/类型、manifest、样式和 workspace 配置。
- 验证：组件包 build、独立 SSR host smoke、jsdom 交互 smoke、客户端 build/typecheck、ChatHeader 测试 2/2、三个 browser-ac 场景及 Electron arm64 未签名 `.app` 目录构建均通过。
- 未完成：Electron 桌面运行时交互、参考图布局、主题和窄屏评审待补。AC-012/013/014/018 保持 UNVERIFIED。

## TP-008：闭环验收与发布

- 关联：DS-010；AC-012/015/016/017/018，并回归所有 AC。
- 产出：补齐进程脚本、真实后端浏览器场景证据、Web/Electron smoke、发布/迁移说明、逐 TP/AC 差异报告。
- 允许路径：当前变更文档目录、scripts/session-*、各 TP 范围内必要修复、现有打包入口的最小适配。禁止通过修改 .harness/ 或放宽证据等级“通过”。
- 内容：真实服务强退后重启，打开轨迹并发送新问题，先读文件核对再创建新工具调用；验证删除、关闭 drain、旧持有者 fencing、审批与取消。
- 验证：全部专用 probes + 默认 Harness 检查 + browser-ac。真实服务场景不要拿 route mock 证明重启持久性。
- 当前进展：crash matrix、真实 transport smoke、同 DB 重启浏览器场景和 AC claim 汇总均通过。真实 server A 退出后，server B 使用同一 DB 恢复会话；前端发送新问题时，本地确定性模型请求包含原调用和未知结果，旧工具未重试。
- 验收证据：Harness run `2026-10-21T07-05-02-997Z-35076`；排除用户要求跳过的 `docker-smoke` 后，17/17 检查通过，18/18 AC claims PASS。详细日志和浏览器截图见 traceability.md 所列证据目录。
- 限制：Docker 镜像构建、macOS GUI 交互、签名和 notarization 未验证。

## Harness 与验证命令

已执行阶段检查：Harness inspect 能读取 18 条 AC、10 个 DS 和 8 个 TP，并识别当前 TP-008；TP-004 独立进程故障矩阵、TP-006 HTTP/IPC transport smoke、TP-007 package host smoke、Electron arm64 未签名目录构建和 TP-008 真实重启浏览器 smoke 均通过。以上还要经过完整 Harness claim 聚合。

```sh
npm run harness:inspect -- --change 2026-10-20-session-trajectory-recovery
npm run typecheck --workspace=mint-server
npm run test --workspace=@mint/session
node scripts/with-node-version.cjs node scripts/session-crash-smoke.mjs
npx prettier --check docs/changes/2026-10-20-session-trajectory-recovery docs/product-specs/README.md docs/design-docs/README.md docs/exec-plans/README.md
git diff --check
```

运行完整 Harness 和浏览器验收。若某个默认检查因本机依赖不可用而提前终止，按相同检查清单单独执行其后的检查；不得删减默认检查：

```sh
npm run dev
npm run harness:verify -- --change 2026-10-20-session-trajectory-recovery --checks "$(cat docs/changes/2026-10-20-session-trajectory-recovery/harness-checks.json)" --writeback
```

harness-checks.json 包含当前默认 checks 和本变更专用 probes；实施时若默认配置有新增检查，需同步更新，不能减少全量检查。browser-scenarios.json 的三个 mock 场景只证明交互。browser-real-scenarios.json 独立保存真实重启场景，由未来的 scripts/session-restart-browser-smoke.mjs 建立隔离 DB 和端口，强退并重启同一服务，启动独立前端代理，再在临时场景目录中用现有 .harness/browser-scenario.mjs 执行；通过 HARNESS_CHANGE_DIR 和 HARNESS_ACCEPTANCE_CRITERIA 传入上下文，不修改 Harness。包装脚本持有所有子进程，结束后清理服务和端口，保存 DB、模型请求捕获、工具调用计数与浏览器证据。fixture 使用确定性本地模型适配器，不调用真实模型。该 probe 必须在 browser-ac 之外执行，不能用 route mock 或热重载冒充真实重启。真实 Electron UI 与 IPC 需要各自证据，不能用 Web 截图代替。

## 验收证据矩阵

| AC     | TP                       | probe                                                | 当前状态 |
| ------ | ------------------------ | ---------------------------------------------------- | -------- |
| AC-001 | TP-001                   | session-contract                                     | PASS     |
| AC-002 | TP-003                   | session-runtime                                      | PASS     |
| AC-003 | TP-002 / TP-003          | session-storage, session-crash                       | PASS     |
| AC-004 | TP-003                   | session-runtime, session-crash                       | PASS     |
| AC-005 | TP-004                   | session-recovery, session-crash                      | PASS     |
| AC-006 | TP-004                   | session-recovery, session-crash                      | PASS     |
| AC-007 | TP-005                   | session-runtime, session-crash                       | PASS     |
| AC-008 | TP-003 / TP-005          | session-runtime                                      | PASS     |
| AC-009 | TP-002                   | session-storage                                      | PASS     |
| AC-010 | TP-002 / TP-006 / TP-007 | session-api, browser-ac                              | PASS     |
| AC-011 | TP-006                   | session-api, session-transport                       | PASS     |
| AC-012 | TP-007 / TP-008          | session-packages, session-ui-integration             | PASS     |
| AC-013 | TP-007                   | browser-ac                                           | PASS     |
| AC-014 | TP-006 / TP-007          | session-api, browser-ac                              | PASS     |
| AC-015 | TP-004 / TP-008          | session-crash, browser-ac, session-restart-browser   | PASS     |
| AC-016 | TP-005 / TP-008          | session-runtime, browser-ac, session-restart-browser | PASS     |
| AC-017 | TP-002 / TP-008          | session-storage, session-crash                       | PASS     |
| AC-018 | TP-003 / TP-005 / TP-008 | session-runtime, session-packages                    | PASS     |

## 执行记录

- 2026-10-20：用户授权先出方案，覆盖前两期并新增面向 Agent 的 React 组件库。选择 @mint/session 与 @mint/agent-ui。
- 2026-10-20：完成现状与参考源码核对；AgentRun 图风险 CRITICAL，已在对话与设计中说明。未进入任何实现 TP。
- 2026-10-20：Harness inspect 通过；18 条 AC、10 条 DS、8 个 TP 可读取。文档静态一致性检查确认 18 条 claim 均绑定现有检查名和最低证据等级，所有 UI AC 有场景；三张索引与两张参考截图路径有效。
- 2026-10-20：本轮新增 Markdown/JSON 与三个索引的 Prettier check、git diff --check 通过。此记录描述最初方案阶段，后续实现和验证记录见下方。

### 2026-10-21：Harness run 2026-10-21T04-35-49-351Z-70811

- 状态：failed
- TP：TP-008
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T04-35-49-351Z-70811
- 检查结果：unit:failed, claims:UNVERIFIED

### 2026-10-21：Harness run 2026-10-21T04-56-42-652Z-79168

- 状态：failed
- TP：TP-008
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T04-56-42-652Z-79168
- 检查结果：unit:failed, claims:UNVERIFIED

### 2026-10-21：Harness run 2026-10-21T04-58-29-935Z-79853

- 状态：failed
- TP：TP-008
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T04-58-29-935Z-79853
- 检查结果：unit:passed, browser-ac:failed, claims:FAIL

### 2026-10-21：Harness run 2026-10-21T05-06-03-241Z-83953

- 状态：failed
- TP：TP-008
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T05-06-03-241Z-83953
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, docker-smoke:failed, claims:UNVERIFIED

### 2026-10-21：Harness run 2026-10-21T05-13-42-993Z-89964

- 状态：failed
- TP：TP-008
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T05-13-42-993Z-89964
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, session-contract:passed, session-storage:passed, session-runtime:passed, session-recovery:passed, session-api:passed, session-crash:passed, session-transport:passed, session-packages:passed, session-restart-browser:passed, session-ui-integration:passed, docker-smoke:failed, claims:PASS
- Docker smoke 错误：`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`。本机 Docker daemon 未运行；检查保留且未绕过。18 条 AC claims 全部 PASS。
- session-transport 首次与包 smoke 并行时因包构建清理竞争失败；随后在 runtime packages 构建完成后串行重跑并通过。真实重启浏览器 smoke 也通过。

### 2026-10-21：Harness run 2026-10-21T06-41-19-969Z-15156

- 状态：failed
- TP：TP-008
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T06-41-19-969Z-15156
- 检查结果：unit:passed, browser-ac:failed, claims:FAIL
