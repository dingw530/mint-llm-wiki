# 会话轨迹持久化与恢复：追溯总览

- change-id：`2026-10-20-session-trajectory-recovery`
- 状态：执行中；TP-009、TP-010 尚未验收
- 创建日期：2026-10-20
- 完成日期：2026-10-21
- 当前 TP：TP-010
- 需求规模：L2。原始 AC-001…018 曾验收 18/18；AC-006 已按无租约设计修订，旧 fencing claim 不再适用，需重验。AC-010、AC-019/020 也尚未验证。Docker smoke 按用户要求跳过；未验证生产环境行为。
- 依赖：`2026-10-20-tool-invocation-arguments`。其已有未提交产出保留，不归入本变更实现。

## 正向与反向追溯

| US / FP / BR / NF                                      | AC     | DS / API                | TP             | 状态       |
| ------------------------------------------------------ | ------ | ----------------------- | -------------- | ---------- |
| US-001/003；FP-001/003；BR-001/002/006；NF-001/007     | AC-001 | DS-001                  | TP-001         | PASS       |
| US-001/003；FP-001/005；BR-002/010；NF-002/007/008     | AC-002 | DS-003                  | TP-003         | PASS       |
| US-001/003；FP-002；BR-003/004；NF-004                 | AC-003 | DS-002/004              | TP-002/003     | PASS       |
| US-001/003；FP-002；BR-005/010；NF-004                 | AC-004 | DS-004                  | TP-003         | PASS       |
| US-001/003；FP-004/006；BR-004/005/006；NF-008         | AC-005 | DS-005                  | TP-004         | PASS       |
| US-001/003；FP-004/006；BR-007/013；NF-004             | AC-006 | DS-005                  | TP-004/010     | UNVERIFIED |
| US-001/003；FP-006；BR-008/011；NF-007                 | AC-007 | DS-006                  | TP-005         | PASS       |
| US-001/003；FP-001/006；BR-009/010；NF-007/008         | AC-008 | DS-003/006              | TP-003/005     | PASS       |
| US-001/003；FP-004；BR-014；NF-008                     | AC-009 | DS-002/010              | TP-002         | PASS       |
| US-002/003；FP-012；BR-012/015；NF-002                 | AC-010 | DS-002/007/008；API-002 | TP-009         | UNVERIFIED |
| US-002/003；FP-007/010；BR-002/011；NF-003/006         | AC-011 | DS-007；API-001/003     | TP-006         | PASS       |
| US-004；FP-008；BR-017；NF-001/005/006                 | AC-012 | DS-001/008              | TP-007/008     | PASS       |
| US-002/004；FP-008/009；BR-012/017；NF-005             | AC-013 | DS-008/009              | TP-007         | PASS       |
| US-002；FP-007/009；BR-012/015；NF-003/005             | AC-014 | DS-007/009；API-001/002 | TP-006/007     | PASS       |
| US-001/002；FP-010；BR-001/006/014/016；NF-008         | AC-015 | DS-005/009              | TP-004/008     | PASS       |
| US-001/002；FP-006/010；BR-008/013；NF-005             | AC-016 | DS-006/009              | TP-005/008     | PASS       |
| US-003；FP-004；BR-007/018；NF-002/004                 | AC-017 | DS-002/005/010          | TP-002/008     | PASS       |
| US-001/003/004；FP-005/006/008；BR-003/009/017；NF-006 | AC-018 | DS-004/006/010          | TP-003/005/008 | PASS       |
| US-001/003；FP-011；BR-011/012；NF-001/007             | AC-019 | DS-003/006/TP-009       | TP-009         | UNVERIFIED |
| US-001/003；FP-012；BR-018；NF-002/008                 | AC-020 | DS-002/TP-009           | TP-009         | UNVERIFIED |

## TP 执行总览

| TP     | 任务                         | 状态   | 产出 / 问题                                                      |
| ------ | ---------------------------- | ------ | ---------------------------------------------------------------- |
| TP-001 | session 契约与纯投影         | 已验收 | build、16/16 单元测试与 AC-001/002/005/008 claim 通过            |
| TP-002 | SQLite、事件存储与旧记录导入 | 已验收 | migration 35、9/9 SQLite 测试与存储相关 claims 通过              |
| TP-003 | 语义记录与检查点             | 已验收 | ReAct、stream、审批路径集成测试与语义记录 claims 通过            |
| TP-004 | 冷修复与强退                 | 需重验 | 原租约/fencing 证据已由 TP-010 设计修订替代                      |
| TP-005 | 统一会话上下文入口           | 已验收 | 新消息和恢复上下文重建、无自动重放相关 claims 通过               |
| TP-006 | 轨迹 API / SSE / IPC         | 已验收 | HTTP/IPC 同库进程探针、详情和安全预览 claims 通过                |
| TP-007 | agent-ui 组件库与页面        | 已验收 | 浏览器 AC、独立宿主、交互 smoke 与包边界 claims 通过             |
| TP-008 | 闭环与发布验证               | 已验收 | 所有非 Docker 检查和 18 条 AC claims 通过；Docker 按用户要求跳过 |
| TP-009 | 权威历史投影与明文迁移       | 进行中 | Session 派生聊天历史；迁移旧载荷至 JSON；补充验收未执行          |
| TP-010 | 移除 Session 写入租约        | 进行中 | 按 Session 日志重建；以同进程活动运行保护和序号 CAS 替代租约     |

## 浏览器场景绑定

| 场景                         | AC             | 证据边界                                                             |
| ---------------------------- | -------------- | -------------------------------------------------------------------- |
| trace-tabs-overview-details  | AC-010/013/014 | mock 仅验证交互和安全预览                                            |
| trace-tabs-preserve-draft    | AC-013/014     | mock 验证视图切换、过滤和 composer 草稿保留                          |
| trace-legacy-and-unavailable | AC-010/015     | mock 验证旧记录缺口和不可读详情                                      |
| trace-real-restart           | AC-015/016     | 真实后端、同 DB 强退重启；需 session-crash 预置，不能使用 route mock |

## 本轮文档产出

product-spec.md、design-doc.md、exec-plan.md、traceability.md、verification-plan.json、browser-scenarios.json、browser-real-scenarios.json、harness-checks.json 与 references/ 中两张用户提供的 DeepSeek 截图；三个快捷索引增加提案入口。后续实现已修改当前变更允许范围内的 Session 包、SQLite 仓库和对话执行入口；依赖变更 `2026-10-20-tool-invocation-arguments` 仍独立保留。

## 文档检查记录

- 2026-10-20：`npm run harness:inspect -- --change 2026-10-20-session-trajectory-recovery` 通过，含专用 checks 的解析也通过。
- 静态自检：18 个 AC、10 个 DS、8 个 TP、18 个计划检查、3 个 mock 场景和 1 个真实重启场景；AC 与最低证据、probes、场景引用一致，索引无重复，参考图片存在。
- `npx prettier --check` 本目录 Markdown/JSON 及三个快捷索引通过；`git diff --check` 通过。
- 以上为最初方案阶段的文档记录。最新实现验收结果见下方 Harness run 2026-10-21T05-13-42-993Z-89964。

## 偏差

| 日期       | 类型         | 内容                                                     | 影响与后续                                        |
| ---------- | ------------ | -------------------------------------------------------- | ------------------------------------------------- |
| 2026-10-20 | 用户补充范围 | 将轨迹面板纳入独立 React 组件库；包名采用 @mint/agent-ui | 已同步 DS-008、TP-007、AC-012；未增加其他组件需求 |

## 后续架构议题（待评估）

| 日期       | 议题                         | 当前判断                                                                                          | 后续评估范围                                                                                     |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 2026-10-21 | AgentRun 与 Session 职责收敛 | Session 可重建持久聊天与轨迹；AgentRun 仍负责进程内活动运行协调。两者的持久恢复记录存在职责重叠。 | 判断是否把显式恢复动作与旧运行兼容迁入 Session；在验证替代能力前不删除 AgentRun 的活动运行职责。 |

该议题尚未形成实施决定，不属于 TP-009 或 TP-010 的验收范围，也未新增 AC。设计依据与源码入口见 `design-doc.md` 的“后续架构议题：AgentRun 与 Session 的职责收敛”。

## TP-003 执行记录

- 2026-10-21：新增可选 `SessionRecordingPort` 并接入普通聊天入口、ReAct 和 ToolLoopEngine；记录用户输入、系统/检索上下文、工具目录、完整模型响应、工具分派及最终模型可见工具结果。分派事件通过 `ToolInvocationRepository.beginWithClaim` 的 SQLite 同步事务回调提交；会话写入租约每分钟续期。
- 产出：`runtime-context.ts`、`session-message-adapter.ts`、`react-loop-core.ts`、`tool-round-engine.ts`、`ai-proxy.ts`、`message-service.ts`、`session-run-writer.ts` 与 message-service 测试适配。
- 验证：服务端 typecheck 通过；ReAct、ToolLoopEngine、message-service、ai-proxy 定向测试 40/40；`@mint/session` 单元测试 14/14；新增同库组合事务回滚探针后，message-service 与真实 SQLite Session 仓库测试 31/31；Prettier 和 `git diff --check` 通过。
- 2026-10-21：修复用户消息与 Session 事件之间的崩溃窗口。消息行、memory scope、会话时间戳和 `turn_started/user_message` 在 `ConversationSessionRepository.withTransaction` 中共同提交；嵌套 Session 追加失败时外层事务回滚消息行和事件游标。
- 2026-10-21：活审批暂停时继续续租；Session 记录审批请求、批准、拒绝和过期。批准后沿用原 Session 记录器，写入工具分派和结果，再继续原 ReAct Run；审批超时后追加审批过期与中断事件并释放租约。工具分派同事务屏障增加真实 SQLite 探针：提交后的工具 handler 能读取对应 Session dispatch；写入权失效时 Ledger claim 回滚且工具执行计数为零。
- 验证：服务端 typecheck 通过；审批 7/7、审批审计/跨表屏障 6/6、租约 3/3、message-service 22/22 定向测试通过；其中真实 SQLite 工具分派/账本屏障探针 2 条通过。`@mint/session` 与前序 TP-001/TP-002 probes 见前序执行记录；所有 AC 仍等待 Harness 聚合。
- 2026-10-21：TP-003 局部实现完成，包括上下文压缩替换、工具结果先于后续模型请求、活审批续租与完整审批状态。真实 SQLite 探针验证 Ledger claim 和 Session dispatch 同事务提交；Session 写入失败时 Ledger 回滚且工具 handler 不运行。审批、拒绝、到期、取消终态与 Session 写入租约均有定向测试。
- 验证：服务端 typecheck 通过；ReAct、审批服务、审批审计/跨表屏障、Session writer、message-service 定向测试通过；格式检查与 `git diff --check` 通过。TP-003 所有 AC 仍 UNVERIFIED，等待 Harness claims 和跨模块进程证据。

## TP-004 执行记录

- 2026-10-21：新增 `repairInterruptedConversation`。它在会话租约内扫描 Session 前缀，读取 Ledger，只追加幂等 `recovery_result`、过期审批和中断边界，不调用工具。Ledger 查询失败时按 `missing` 处理并保留未知状态。
- 2026-10-21：普通新消息路径在写入新用户事件前执行冷修复，再从 Session 投影恢复 assistant tool-call 与合成 tool-result，最后追加本轮用户输入。恢复与新输入共享同一会话 fencing lease。
- 验证：服务端 typecheck 通过；冷修复服务真实 SQLite tests 3/3，覆盖 Ledger succeeded、未分派调用、幂等重复、过期审批和活租约阻止；message-service tests 23/23，覆盖恢复工具调用/结果在新用户输入之前进入模型上下文。
- 2026-10-21：新增并通过 `scripts/session-crash-smoke.mjs`。独立子进程提交 Session dispatch / Ledger claim 后，只写入目标文件第一段，随后由父进程发送 SIGKILL。新进程打开同一 DB 并验证 Ledger `outcome_unknown`、原始 attempt 数为 1、模型历史保留原工具调用和未知结果、文件仍为部分内容、重复恢复不追加第二份结果。
- 2026-10-21：扩展独立进程探针，覆盖模型调用未分派、分派后副作用前、部分写入、Ledger 成功但 Session 结果缺失、工具结果已提交但下一轮未开始、Bash 路径策略拒绝、冷审批过期、活动所有者阻止另一进程修复、租约接管后旧 fencing token 写入拒绝，以及重复恢复。
- 验证：所有子进程探针通过。证据包含隔离 SQLite 中的 Ledger 状态与 attempt、实际文件内容、恢复事件状态、模型可见工具结果、审批状态、拒绝路径的 handler 执行计数和旧持有者的 fencing 错误。
- GitNexus：上次可用的 `sendMessageRequest` 影响报告是 HIGH（5 个符号、3 条流程）。当前存储索引早于本轮；项目 CLI runner 的 analyze/impact 尝试分别在 15 秒和 10 秒后超时，原因是 runner 等待外部包解析。未将空结果当作无影响；同时检查了实际调用源码。
- AC-005/006/015/016 仍需 Harness claim 聚合和真实服务浏览器重启证据，状态保持 UNVERIFIED。

## TP-005 执行记录

- 2026-10-21：恢复按钮使用 Session 冷修复后的模型历史，创建 successor turn 并记录 `originRunId`、`recoveryActionId` 和动作类型。普通发送先修复中断前缀，再追加新用户输入；模型历史保留原工具调用与恢复结果。
- 2026-10-21：重新生成只保留最后一个用户请求前缀。若该请求后存在工具调用或结果，HTTP 预检返回 409，要求用户发起新请求，避免重复执行副作用。
- 验证：message-service 与冷恢复服务定向测试通过；服务端 typecheck 通过。AC-007/008/016/018 仍需 Harness claim 和恢复重启证据。

## TP-006 执行记录

- 2026-10-21：新增会话轨迹安全预览分页、固定高水位和按事件标识显式详情 API。会话归属先于读取；预览只返回投影行，事件载荷由用户点击后单独读取。统一 endpoint 描述同时生成 HTTP 和 Electron IPC 请求处理器。
- 产出：`conversation-trajectory-service.ts`、conversations endpoint descriptors、客户端轨迹 API、Electron preload 与 `ElectronAPI` 声明、manifest。
- 验证：轨迹服务测试 3/3；IPC handler 测试 9/9、轨迹 IPC 测试 2/2；服务端 typecheck/build 和客户端 typecheck/build 通过；三个 Harness browser-ac 轨迹场景通过。
- Web 使用带 Last-Event-ID 的 SSE；Electron 在主进程内调用同一 stream descriptor，经 IPC 推送和取消，不启动隐藏 HTTP。
- `session-transport-smoke` 在同一隔离 DB 上通过真实 HTTP server 与 Electron IPC adapter，验证快照水位、快照/订阅交界补发、详情 parity、游标重连去重和取消清理。历史记录中的 AC-010/011/014 待聚合状态已由最新 Harness claim 结果覆盖。

## TP-007 执行记录

- 2026-10-21：新增独立 `@mint/agent-ui` 包及 `AgentTracePanel`。Mint 聊天标题增加“对话/轨迹”页签；轨迹显示输入、模型、工具泳道，支持时长/轮次/调用视图、搜索、未知状态、完整性提示及显式详情展开。composer 在页签切换时保持挂载。
- 验证：组件包 build、独立 React SSR host smoke 与 jsdom 交互 smoke 通过；Mint 客户端 build/typecheck 通过；Electron arm64 未签名 `.app` 目录构建通过，ASAR 含 main、preload、server/client bundle；ChatHeader 测试 2/2；三个 browser-ac 场景通过。
- 未执行签名后的 macOS GUI 验收、窄屏和主题专项评审；这些不影响当前 AC claim 结果。
- 2026-10-21：按 DeepSeek 参考收紧轨迹面板整体密度，调整标题区、泳道、搜索栏和事件行的间距与字号，扩大列表可见区域；不改变事件顺序、筛选、详情加载和响应式行为。此项是 TP-007 的视觉细化，不新增 AC。

## TP-008 执行记录

- 2026-10-21：一次受限运行因本地端口和 Chrome 启动失败；之后按项目要求启动开发服务并重跑。最新完整非 Docker Harness 已通过，见运行 `2026-10-21T07-05-02-997Z-35076`。
- 通过证据：Session 16/16；Session integration 54/54；IPC/tool lookup 16/16；Session crash matrix；Session packages smoke；`@mint/agent-ui` build、host smoke、UI integration；server typecheck。最新 Harness 另覆盖 unit、browser-ac 三场景、coverage、boundary、生命周期、signal、Electron smoke 和所有 Session probes。
- Docker smoke 按用户要求跳过，没有修改默认 Harness 配置。Docker 镜像构建、macOS GUI 交互、签名和 notarization 未验证。

- 2026-10-21：新增 `session-restart-browser-smoke.mjs`。脚本在隔离 SQLite 中保存已成功 `read_file` 结果、Ledger executing 的 `write_file` 调用和部分文件；启动 server A 读取同一会话后强制退出，等待租约失效，再用同一 DB 启动 server B。
- 浏览器打开轨迹并展开原调用参数，切换页签后保留草稿并发送新问题。本地确定性 OpenAI-compatible 服务捕获实际模型请求；检查成功读取、原始写调用、未知结果、新问题的顺序，且旧工具没有重试。
- 验证：真实服务重启和浏览器 smoke 通过。attempt 保持 1，恢复结果和最终回答各一份，部分文件未变化。截图、隔离 DB、工具文件、模型请求和 verification-evidence.json 保存在 `.harness/runs/2026-10-20-session-trajectory-recovery/session-restart-browser-*`。
- 历史运行 `2026-10-21T05-13-42-993Z-89964` 中，生命周期集成和 Electron process smoke 通过；当时 Docker daemon 未运行，因此该次默认 Harness 总状态为 failed。最新运行结论见下方。

## 交接

TP-001 至 TP-008 已完成。最新非 Docker Harness 通过 17/17 检查并汇总 18/18 AC claims PASS；Docker smoke 按用户要求跳过。macOS GUI、签名和 notarization 未验证。

- 最新 Electron arm64 `.app` 目录构建通过，ASAR 含 `main.js`、`preload.js`、`server-dist/index.js` 和 `client-dist/index.html`。产物位于 `/private/tmp/mint-electron-artifacts/mac-arm64/Mint.app`；构建未签名。

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
- Electron arm64 `.app` 目录构建随后单独重跑并通过；ASAR 内容已检查。Prettier 和 `git diff --check` 检查通过，Harness inspect 识别 TP-008 与 18 条验收标准。

### 2026-10-21：Harness run 2026-10-21T06-41-19-969Z-15156

- 状态：failed
- TP：TP-008
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T06-41-19-969Z-15156
- 检查结果：unit:passed, browser-ac:failed, claims:FAIL

### 2026-10-21：Harness run 2026-10-21T06-58-29-071Z-27213

- 状态：failed
- TP：TP-008
- 运行范围：临时检查清单排除 docker-smoke、browser-ac、session-restart-browser；仓库默认检查配置未修改。
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T06-58-29-071Z-27213
- 检查结果：unit:failed；4 个用例因 `listen EPERM` 失败，Harness 在首项检查后停止，claims:UNVERIFIED。
- 本次独立补验：Session 16/16；Session integration 54/54；IPC/tool lookup 16/16；session-crash、session-packages、agent-ui integration 和 server typecheck 通过。session-transport 与浏览器检查受 `listen EPERM` / Chrome 子进程退出限制。
- Docker smoke 按用户要求跳过。待在允许本机端口监听及浏览器启动的环境中复验剩余项；不需要为此修改 Docker 配置。

### 2026-10-21：Harness run 2026-10-21T07-05-02-997Z-35076

- 状态：completed
- TP：TP-008
- 运行范围：默认 Harness 检查清单仅排除 `docker-smoke`，未修改仓库默认配置。
- 证据目录：.harness/runs/2026-10-20-session-trajectory-recovery/2026-10-21T07-05-02-997Z-35076
- 检查结果：17/17 checks passed；18/18 AC claims PASS。包括 unit、browser-ac、coverage、boundary、lifecycle-integration、signal-smoke、electron-smoke 和全部 Session probes。
- Docker smoke 按用户要求跳过。基于该范围，TP-008 完成。

## TP-009 执行记录

- 状态：进行中；AC-010、AC-019/020 尚未完成 Harness claim 聚合。
- 目标：让聊天记录和轨迹都从 Session 重建，并把 Session 事件存储切换为 JSON 明文，解决当前聊天只显示最终回答、读取轨迹需要逐事件解密的问题。
- 已修改：产品规格、设计、执行计划、verification plan、harness checks 和本追溯文档；Session model_message 增加最终聊天 messageId；同一 turn 的中间模型响应和最终回答合并为一个 assistant 气泡，同时保留最终 messageId；历史 Session segments 与持久 A2UI 来源块合并展示，恢复时将来源卡片定位到实际显示正文末尾，避免流式偏移遗漏尾部字符；migration 36 转换旧事件载荷；Session repository 读写 JSON；客户端区分 outcome_unknown。
- 验证：Session 包构建、服务端和客户端 TypeScript 检查通过；Session 包测试 17/17，服务端定向测试 43/43，MessageList 测试 2/2；Prettier、`git diff --check` 和 `harness:inspect` 通过。覆盖旧密文迁移成功、错误密钥触发事务回滚、迁移后无密钥读取 JSON、同一 turn 合并和持久 A2UI 来源恢复。
- 本次位置回归验证：服务端定向测试 28/28，TypeScript 检查、Prettier 和 `git diff --check` 通过；覆盖持久偏移少于最终正文长度时将来源卡片放到显示文本末尾。
- 未验证：Electron 与真实浏览器重启场景；AC-010、AC-019/020 仍等待 Harness claims 聚合，TP-009 保持进行中。
- 影响分析限制：GitNexus 当前无法刷新，runner 试图下载 npm 包时遇网络策略拒绝。按既有结果保留 `getMessages` LOW、`decodeEvent` HIGH 风险认知；没有将 CLI 空输出当作无影响。

### 2026-10-21：轨迹重复模型响应回归修复

- 根因：ReAct 外层和 `ToolLoopEngine.executeRound` 同时记录同一模型响应，导致工具调用 `callId` 在会话历史中重复，轨迹读取校验失败。
- 修复：ReAct 外层作为唯一记录者；读取历史时仅折叠同一运行、轮次及消息内容完全相同的旧重复事件，并在轨迹中标记“已忽略”。参数或响应不同的重复 `callId` 仍拒绝读取。
- 验证：服务端相关 6 个测试文件 31/31、`@mint/session` 16/16、服务端 typecheck、Prettier 和 `git diff --check` 通过。覆盖旧账本全量读取、分页、详情、模型历史投影及冲突重复仍 fail closed。

## TP-010 执行记录

- 状态：进行中；AC-006 需按修订后的无租约语义重新验证。
- 设计调整：移除 Session writer 的持久租约、心跳和 fencing token。活动运行由当前进程的 AgentRunRegistry / ConversationScopeLock 识别；进程重启后由持久 Session 扫描并重建中断结果。Session 追加保留 `lastSequence` 比较并交换，冲突时 SQLite 事务回滚；恢复服务重新读取日志后重算。
- 实现改动：删除 `ConversationSessionLease`、claim/renew/release API、writer heartbeat 与 `hasActiveOwner` 分支；从普通发送、恢复入口和恢复服务移除租约依赖；新数据库不创建旧租约列，migration 37 删除旧表中的 owner/fence/expiry 列；恢复并发序号冲突最多重算三次。
- 保留的活动保护：聊天和轨迹读取遇到进程内活动会话时跳过冷修复；同进程普通请求仍由 ConversationScopeLock 阻止并发。该保护不依赖持久数据库租约。
- 验证：服务端 typecheck、Prettier 和 `git diff --check` 通过；未执行测试或 Harness。GitNexus impact runner 无输出并在等待后被中止；已用 `rg` 核对生产调用点，影响分析未完成。
