# AgentRun 可恢复持久化与可替换存储追溯总览

## 变更状态

| 属性     | 值                                           |
| -------- | -------------------------------------------- |
| 变更     | 2026-09-18-agent-run-recoverable-persistence |
| 当前阶段 | 已完成                                       |
| 开始日期 | 2026-09-18                                   |
| 完成日期 | 2026-09-19                                   |
| 关联债务 | TD-006、PP-006                               |

## 需求到设计到执行追溯

| 需求                            | 设计               | 执行任务           | 当前证据状态 |
| ------------------------------- | ------------------ | ------------------ | ------------ |
| US-001 / AC-001                 | DS-002/003/006     | TP-002/004/005     | 已验证：unit + browser AC |
| US-002 / AC-003                 | DS-002/004/005     | TP-002/003/004/005 | 已验证：unit + browser AC |
| US-003 / AC-002/004             | DS-003/004/006     | TP-003/004/005     | 已验证：unit + browser AC |
| US-004 / AC-005/007             | DS-001/007         | TP-001/002/005     | 已验证：unit/boundary 证据 |
| BR-001/002/003 / AC-005/006/007 | DS-001/002/007     | TP-001/002/005     | 已验证：unit/boundary 证据 |
| BR-004~~009 / AC-001~~004       | DS-003/004/005/006 | TP-002/003/004/005 | 已验证：unit + browser AC |
| NF-001~005 / AC-005/006         | DS-001/002/007     | TP-001/002/005     | 已验证：unit/boundary 证据 |

## TP 执行记录

| TP     | 当前状态 | 产出文件                                  | 验证结果                                           | 备注                                                |
| ------ | -------- | ----------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| TP-001 | 已完成   | persistence port、SQLite factory          | `tsc --noEmit` 与 focused tests 通过。             | GitNexus 图查询降级，改用源码导入链与回归测试审查。 |
| TP-002 | 已完成   | migration #30、recovery action repository | repository/recovery focused tests 通过。           | SQLite 是唯一本期 backend。                         |
| TP-003 | 已完成   | recovery service、后继 run 创建           | focused recovery tests 通过。                      | 未确认副作用工具不自动重放。                        |
| TP-004 | 已完成   | HTTP/IPC recovery transport、恢复卡片     | client/server 类型检查、IPC handler tests、browser AC 通过。 | Electron 已补专用流式 IPC。                         |
| TP-005 | 已完成   | Harness run、typecheck、build             | `harness:verify` 通过（run `2026-09-19T09-41-16-679Z-57548`）：8 项检查全通过、7/7 AC PASS、unit 935 passed、三个 browser 场景通过。 | browser 运行保留已知 CSP meta 警告。               |

## 偏差记录

| 日期 | 类型 | TP | 文件 | 原因 | 影响 | 后续动作 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 | 已解决 | TP-004 | `electron/ipc/chat.js`、`electron/preload.js`、`agentRunRecovery.ts` | Electron 不可访问 Web SSE。 | 恢复 action 曾只能 reservation，无法启动 successor run。 | 新增 `chat:stream-recovery-action`，复用既有 chunk/done/error IPC 事件。 |

| 2026-09-19 | 已解决 | TP-005 | `verification-plan.json` | AC-003 声明 `ordering`、AC-004 声明 `no_new_work`，但两者的 probes 均漏列唯一提供这两个不变量的 `lifecycle-integration`，导致最后一次运行判为 UNVERIFIED（探针本身全部通过）。 | 验证计划映射缺陷，非功能缺口；已补 probes 并重跑。 | 重跑结果：8 项检查全通过、7/7 AC PASS（run `2026-09-19T09-41-16-679Z-57548`）。 |

## 交接

- 当前进度：恢复 action 已能在 HTTP SSE 与 Electron IPC 上启动 successor run；前端复用普通聊天事件 reducer 展示流式结果；浏览器 Harness 三个场景和 `harness:verify` 已通过。
- 下一步：如需发布前增强证据，可补 Electron 真机 recovery 操作验收；本变更当前功能验收已完成。
- 已知风险：GitNexus `detect_changes` 被工作区既有 161 文件变更污染，无法用于本变更的独立 blast-radius 判断；重启后旧审批上下文不可用；JSONL 不属于本期实现；浏览器日志保留已知 CSP meta 警告。
