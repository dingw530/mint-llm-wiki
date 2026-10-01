# 追溯总览：记忆界面默认全局

## 状态

已完成（2026-10-01）；开始于 2026-10-01。相关后端与真实历史数据结论见 [2026-09-30 Memory 变更](../2026-09-30-memory-context-optimization/traceability.md)。

## 需求到验收

| 需求                       | 设计           | TP     | AC             | 状态   |
| -------------------------- | -------------- | ------ | -------------- | ------ |
| 移除知识空间界面、默认全局 | DS-001～DS-005 | TP-001 | AC-001、AC-002 | 已完成 |
| 保留现有 scope 逻辑        | DS-004         | TP-002 | AC-003         | 已完成 |

## AC 状态总览

| AC     | Status | Evidence                                                                                 |
| ------ | ------ | ---------------------------------------------------------------------------------------- |
| AC-001 | PASS   | `memory-ui.log`、`browser-ac.log`；控件缺席，空间 API 500 sentinel 未触发                |
| AC-002 | PASS   | `memory-ui.log`、`memory-scope.log`、`browser-ac.log`；global payload 和历史全局归属流程 |
| AC-003 | PASS   | `memory-scope.log`；existing binding 保留，unbound global 与 scope isolation             |

最终 claims 见 `.harness/runs/2026-10-01-memory-global-default-ui/2026-10-01T03-56-20-616Z-62990/claim-verification.json`。

## 执行记录

- 影响范围初步核对：Settings `MemoriesPanel`、`MemoryPanelViews`、`memoryPanelModel`，以及 ChatArea→ChatAreaView→ChatHeader；服务端 API/repositories 不在改动目标内。
- GitNexus impact CLI 没有在本次查询时间内返回结果；编辑前以全仓文本引用核对这些组件调用点，最终边界测试和行为集成测试负责验证后端 scope 保持。
- 后续按 TP 追加文件、probe、结果和偏差。

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

## 最终验收

Harness run `2026-10-01T03-56-20-616Z-62990`：3/3 AC PASS；`claim-verification.json` 与四类 probe logs 位于 `.harness/runs/2026-10-01-memory-global-default-ui/2026-10-01T03-56-20-616Z-62990/`。
