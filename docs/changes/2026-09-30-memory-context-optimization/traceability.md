# 追溯总览：记忆分层、空间召回与领域收敛

## 变更状态

- 状态：已完成（2026-09-30）。
- 创建日期：2026-09-30。
- 实际交付：规格、设计、计划、Memory 领域实现、质量评估、入口/浏览器/生命周期证据与逐 AC 验收。
- 产品验收状态：AC-001～AC-013 全部 PASS；Harness run `2026-10-01T03-18-43-494Z-40308` 的 `claim-verification.json` 覆盖每项 requiredEvidence 与 invariants。
- 上位依赖：[2026-09-29-server-structure](../2026-09-29-server-structure/design-doc.md)，上位提案的其他领域仍待启动；本变更只完成 Memory 专项映射，不推进其余任务。
- 既有契约：[Memory P0](../2026-08-03-memory-p0-hardening/design-doc.md)、[ContextProvider](../2026-08-14-context-provider/design-doc.md)、[Server 生命周期](../2026-09-11-server-lifecycle-remediation/design-doc.md)。

## 需求到实现计划

| 需求            | 规则/非功能                             | 设计/API                                           | TP                             | AC                             | 状态   |
| --------------- | --------------------------------------- | -------------------------------------------------- | ------------------------------ | ------------------------------ | ------ |
| US-001 / FP-001 | BR-001、BR-002、BR-005、BR-006 / NF-001 | DS-003、DS-005 / API-001、API-002                  | TP-003、TP-005、TP-007         | AC-001、AC-002、AC-009         | 已完成 |
| US-002 / FP-002 | BR-003、BR-008、BR-009                  | DS-002、DS-007、DS-008 / API-004、API-005、API-006 | TP-003、TP-006、TP-007         | AC-001、AC-003、AC-006、AC-009 | 已完成 |
| US-003 / FP-003 | BR-007 / NF-002                         | DS-004、DS-009                                     | TP-004、TP-008                 | AC-004、AC-013                 | 已完成 |
| US-004 / FP-004 | BR-004、BR-010 / NF-003                 | DS-002、DS-003、DS-004 / API-003、API-006          | TP-003、TP-004、TP-006         | AC-005、AC-006、AC-011         | 已完成 |
| US-005 / FP-005 | BR-011、BR-012 / NF-004                 | DS-006、DS-007、DS-008                             | TP-006、TP-007、TP-008         | AC-007、AC-008、AC-009         | 已完成 |
| US-006 / FP-006 | BR-013 / NF-001、NF-004、NF-005         | DS-001、DS-009、DS-010                             | TP-001、TP-002、TP-008、TP-009 | AC-010、AC-012、AC-013         | 已完成 |

## AC 状态总览

| AC     | TP                     | probe                                        | 状态 | 当前证据                                                                                          |
| ------ | ---------------------- | -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| AC-001 | TP-003、TP-007         | memory-integration、browser-ac               | PASS | migration 保留旧行；旧事实可管理不可召回；browser legacy assignment                               |
| AC-002 | TP-005、TP-006         | memory-unit、memory-entry                    | PASS | 预算/打包断言与 adapter 最终消息估算                                                              |
| AC-003 | TP-003、TP-004、TP-006 | memory-integration、memory-entry             | PASS | global/A/B、归档/伪造空间与 scope snapshot 隔离                                                   |
| AC-004 | TP-004                 | memory-unit、memory-integration              | PASS | 中文/技术标识召回、无匹配 abstain 与排序 fixture                                                  |
| AC-005 | TP-003、TP-004         | memory-integration                           | PASS | 状态/有效期过滤、同事务 FTS 更新与故障回滚                                                        |
| AC-006 | TP-003、TP-006         | memory-integration、memory-entry             | PASS | A→B→A revision、消息快照、job/transcript 隔离与幂等                                               |
| AC-007 | TP-006、TP-007         | memory-entry、browser-ac                     | PASS | disabled 零记忆工作断言；`browser-disabled-management` 仍能保存                                   |
| AC-008 | TP-006、TP-008         | memory-entry、memory-process、electron-smoke | PASS | 普通/ReAct、CLI/REPL 与 Electron 入口；单块/SSE/重启观察                                          |
| AC-009 | TP-007                 | memory-integration、browser-ac               | PASS | 端点往返、HTTP/IPC parity 与四个浏览器流程场景                                                    |
| AC-010 | TP-001、TP-002、TP-008 | boundary、memory-static、memory-entry        | PASS | Memory boundary、typecheck/build/bundles 与 import/entry checks                                   |
| AC-011 | TP-002、TP-006、TP-008 | memory-lifecycle、memory-process             | PASS | worker drain、CLI/REPL 重启、Electron shutdown 后拒绝请求                                         |
| AC-012 | TP-005、TP-008         | memory-unit、memory-integration              | PASS | content-free observation、selected access-only                                                    |
| AC-013 | TP-008                 | memory-quality                               | PASS | 30 cases/26 lexical answerable/10k fixture；Recall@8=1.0、unrelated=0、cross-scope=0、p95=1.453ms |

证据根目录：`.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-54-56-888Z-49204/`。细节由 `claim-verification.json`、各 probe log、browser traces/screenshots、Electron/CLI process 输出及 `evidence/implementation/TP-008/quality-report.json` 支撑。

## 偏差记录

| 日期       | 类型     | TP            | 文件                                                         | 原因                                                                                                                              | 影响                                                                                                                                                            | 后续动作           |
| ---------- | -------- | ------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 2026-09-30 | 入口契约 | TP-007        | `memories:list` endpoint/preload/API                         | 可选 query 参数压缩造成 HTTP/IPC 参数错位；改为完整 query 对象，并默认排除未归属、显式查看时包含                                  | 初次 Electron smoke 发现 HTTP 500；已修复并通过 Electron/browser/HTTP 测试                                                                                      | 已关闭             |
| 2026-09-30 | 迁移兼容 | TP-008        | `server/migrations/index.ts`、recovery fixture               | migration #32 假设精简 fixture 已含 `memory_events`/jobs 表；增加可选旧表兼容并覆盖最小 fixture                                   | 初次全量 Server regression 暴露；回归与最终全量 Harness 通过                                                                                                    | 已关闭             |
| 2026-09-30 | 验收路由 | TP-008        | `browser-scenarios.json`、endpoint HTTP fixture              | API glob 也匹配 `/src/services/api/*`；精确锚定 `http://localhost:5800/api/...`。coverage 的 localhost fixture 改用 IPv4 loopback | 浏览器模块 MIME 错误及 coverage HTTP parser failures 已消除；全量 browser/coverage 通过                                                                         | 已关闭             |
| 2026-10-01 | 历史列表 | TP-007/TP-008 | endpoint helper、client API、preload、manifest query mapping | 无名 query descriptor 曾丢弃完整 query，待归属筛选未传到服务端；修复后 HTTP/IPC 都传 query object                                 | 真实库旧记录 API 可见；37 条无冲突项归全局，84 条/7 个冲突键保留待归属；证据见 `evidence/implementation/TP-008/live-history-repair.json`                        | 冲突组待用户决定   |
| 2026-10-01 | 历史列表 | TP-007/TP-008 | endpoint helper、client API、preload、manifest query mapping | 无名 query descriptor 曾丢弃完整 query，导致待归属筛选没有传到服务端；修复后 HTTP/IPC 都传 query object                           | 真实库 121 条旧记忆；API 修复后 GET 返回 121。37 条无冲突项归全局，84 条/7 个冲突键保留待归属；证据见 `evidence/implementation/TP-008/live-history-repair.json` | 等待冲突组处理策略 |

## 规划记录与交接

以下按时间保留阶段性记录；如早期记录中的 AC 状态与当前总览不一致，以顶部最终 Harness 聚合结果为准。

- 2026-09-30：TP-001 已完成依赖基线与 Memory 领域边界规则。Harness 自测 18 项、原 memory-focused suites 51 项、boundary 5 项通过，server typecheck/build 及 Electron/MCP bundle 成功。证据在 `evidence/implementation/TP-001/`。
- 2026-09-30：TP-002 模块拆分已完成；Memory domain、infrastructure、bootstrap、消息/endpoint/runtime/eval/Electron consumers 已归位。迁移前构建/bundle/boundary 记录于执行记录，TP-003 合并后另跑 focused suites 与 typecheck。
- 2026-09-30：TP-003 已完成数据层交付：migration #32、空间与绑定数据层、不可变消息作用域快照、revision jobs/transcript 隔离、scope-aware memory 写入/审计、冲突批量回滚与日期区间校验；122 项相关回归、boundary 5 项、typecheck/build 通过。AC-001/003/005/006 仍 UNVERIFIED，检索与管理入口未完成。
- 2026-09-30：TP-004 已完成独立 FTS5 投影、tokenizer 版本启动重建、中文/技术词法召回、scope/status/time SQL 过滤、相关性排序与无 fallback 降级；用词不重合的查询明确返回空。
- 2026-09-30：TP-005 已完成常驻画像白名单与用户策略优先、事实预算打包、XML escaping、选中访问计数和内容无关观察数据。
- 2026-09-30 阶段记录：TP-006 当时进行中，先接入消息 scope 快照、worker transcript 隔离和 ContextProvider 预算。后续完成了普通/ReAct、压缩、并发绑定保护、CLI/REPL/Electron 和生命周期验收；见最终 TP-006～TP-008 记录及 Harness run。
- 2026-10-01：真实 UI 空列表反馈后，修复了 Express query 提取、client manifest query-object 序列化及 Electron IPC object forwarding；live API 现返回 global 37 条、unassigned 84 条。历史归属保留的冲突决策尚待用户选择。

- 2026-09-30：用户要求参考 agentmemory 设计 Mint 记忆改造，同时按照 Server 结构提案调整代码组织方案；用户确认知识空间作用域、未绑定用全局。
- 2026-09-30：检查当前 Mint、agentmemory 源码和既有文档；刷新 GitNexus 并保存影响证据。applyContextProviders=HIGH，buildMemoryContext=UNKNOWN 已用别名引用核对；流程采样有截断，不能视为完整调用图。
- 实际文件：本目录 SDD、评估和运行证据；TP-001/002/003 的源码产出与验证见 `exec-plan.md` 执行记录及对应 `evidence/implementation/`。
- 文档检查结果将在 check-doc.md 记录；该记录只证明方案结构和可消费性，不推进本表 AC。
- 执行交接：TP-001～TP-009 已完成，AC-001～AC-013 全部 PASS；当前没有本变更待执行的功能任务。
- 限制：未调用真实模型 API、未运行外部 ingest；Recall/延迟数据仅适用于已保存的固定 fixture 与本机环境。独立第三方审阅未执行，审计能力降级已记录。

### 2026-09-30：Harness run 2026-09-30T15-05-05-692Z-85468

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-05-05-692Z-85468
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-05-29-439Z-85768

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-05-29-439Z-85768
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-07-43-246Z-90097

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-07-43-246Z-90097
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-14-44-925Z-2824

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-14-44-925Z-2824
- 检查结果：server-regression:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-20-40-434Z-11038

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-20-40-434Z-11038
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:failed, claims:FAIL

### 2026-09-30：Harness run 2026-09-30T15-33-30-351Z-30730

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-33-30-351Z-30730
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:failed, claims:FAIL

### 2026-09-30：Harness run 2026-09-30T15-34-40-311Z-31906

- 状态：failed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-34-40-311Z-31906
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:failed, claims:UNVERIFIED

### 2026-09-30：Harness run 2026-09-30T15-41-43-944Z-37804

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-41-43-944Z-37804
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:passed, electron-smoke:passed, claims:PASS

### 2026-09-30：Harness run 2026-09-30T15-54-56-888Z-49204

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-09-30T15-54-56-888Z-49204
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:passed, electron-smoke:passed, claims:PASS

### 2026-10-01：Harness run 2026-10-01T03-17-15-559Z-38895

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-10-01T03-17-15-559Z-38895
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:failed, claims:FAIL

### 2026-10-01：Harness run 2026-10-01T03-18-43-494Z-40308

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-30-memory-context-optimization/2026-10-01T03-18-43-494Z-40308
- 检查结果：server-regression:passed, client-regression:passed, memory-unit:passed, memory-integration:passed, memory-entry:passed, memory-lifecycle:passed, memory-quality:passed, memory-process:passed, browser-ac:passed, memory-static:passed, boundary:passed, coverage:passed, electron-smoke:passed, claims:PASS

### 2026-10-01：query-object 修复后的完整 Harness run 2026-10-01T03-18-43-494Z-40308

- 状态：completed；`memory-verification.json` status=passed、claimStatus=PASS。
- 检查结果：13 个 configured probes 全部通过；AC-001～AC-013 全部 PASS。
- 新增覆盖：无名 query mapping 的整个对象透传；HTTP 待归属历史筛选与 client URL 序列化。
- live 数据状态：37 条无冲突历史记忆归 global，84 条/7 个冲突键保持 unassigned，等待策略选择；报告与快照位置见 `evidence/implementation/TP-008/live-history-repair.json`。
