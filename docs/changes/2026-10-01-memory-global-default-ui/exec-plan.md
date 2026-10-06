# 执行计划：记忆界面默认全局

## 范围与执行原则

这是 L1 产品 UI 简化。只修改记忆设置/聊天视图及对应 client model/tests/browser scenarios；服务端空间/作用域实现保持原样。工作区有其他未提交改动，必须保留。

| TP     | 内容                                             | 状态   | AC             | 验证                      |
| ------ | ------------------------------------------------ | ------ | -------------- | ------------------------- |
| TP-001 | 移除空间 UI，设置手动创建与历史归属默认为 global | 已完成 | AC-001、AC-002 | `memory-ui`、`browser-ac` |
| TP-002 | 核验既有绑定与未绑定全局召回逻辑                 | 已完成 | AC-003         | `memory-scope`            |
| TP-003 | 全量相关回归、浏览器验收和追溯收尾               | 已完成 | AC-001～AC-003 | 完整 Harness              |

完成条件：每条 AC 的 requiredEvidence 与 invariants 有实际证据并 PASS；新增/修改 TSX 文件通过 Prettier 和 `git diff --check`；不得声称空间 UI 之外的 server 能力已移除。

### 2026-10-01：Harness run 2026-10-01T03-52-57-196Z-59524

- 状态：failed
- TP：TP-001
- 轮次：1
- 证据目录：.harness/runs/2026-10-01-memory-global-default-ui/2026-10-01T03-52-57-196Z-59524
- 检查结果：client-regression:passed, memory-ui:passed, memory-scope:passed, browser-ac:passed, memory-static:passed, claims:UNVERIFIED

### 2026-10-01：Harness run 2026-10-01T03-56-20-616Z-62990

- 状态：completed
- TP：TP-001
- 轮次：1
- 证据目录：.harness/runs/2026-10-01-memory-global-default-ui/2026-10-01T03-56-20-616Z-62990
- 检查结果：client-regression:passed, memory-ui:passed, memory-scope:passed, browser-ac:passed, memory-static:passed, claims:PASS

### 最终执行记录

- Harness run：`2026-10-01T03-56-20-616Z-62990`，status `passed`，AC-001～AC-003 全部 PASS。
- 验证：client regression、记忆 UI tests、现有 scope integration、浏览器场景、typecheck、static build/boundary 全通过。
- 产物：记忆面板与聊天头部不再提供知识空间控件；手动创建与旧记忆批量归属默认仅用用户全局；空间/绑定服务端逻辑未改。

### 提交前验证：2026-10-01

- 全量 pre-commit 的 typecheck、test、engineering-tests 通过；首轮 client lint 发现 MemoryPanelViews 中未使用的 MemoryPanelToast 类型导入，删除后按正常 hook 重试。图谱尚未索引该新文件，impact 为 UNKNOWN；文本核验其仅由记忆面板消费，修改仅移除未使用 type-only import。
