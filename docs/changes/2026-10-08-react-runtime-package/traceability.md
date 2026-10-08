# 追溯总览：可移植的最小 ReAct 框架包

## 状态

| 属性     | 值                               |
| -------- | -------------------------------- |
| 变更标识 | 2026-10-08-react-runtime-package |
| 状态     | 已完成                           |
| 完成日期 | 2026-10-08                       |
| 当前阶段 | 全部 TP 完成                     |

## 需求与验收追溯

| ID     | 需求/规则                     | 设计       | TP         | 状态   |
| ------ | ----------------------------- | ---------- | ---------- | ------ |
| US-001 | 通用接口运行 ReAct            | DS-001/002 | TP-001     | 已完成 |
| US-002 | Mint 能复用独立核心           | DS-001/004 | TP-002     | 已完成 |
| US-003 | 有界、可取消并正确回填结果    | DS-002/003 | TP-001     | 已完成 |
| US-004 | Node 项目复用通用工具运行边界 | DS-006/007 | TP-004/005 | 已完成 |
| AC-001 | 包独立构建、导入与打包        | DS-001/005 | TP-001/003 | PASS   |
| AC-002 | 多轮工具调用及 call ID 回填   | DS-002     | TP-001/003 | PASS   |
| AC-003 | step limit、取消、错误终态    | DS-003     | TP-001/003 | PASS   |
| AC-004 | Mint 原有入口和执行语义兼容   | DS-004     | TP-002/003 | PASS   |
| AC-005 | 无真实服务依赖的 Node 示例    | DS-005     | TP-001/003 | PASS   |
| AC-006 | Tool Runtime 独立构建与安装   | DS-006     | TP-004/006 | PASS   |
| AC-007 | Tool Runtime 安全有界执行     | DS-006     | TP-004/006 | PASS   |
| AC-008 | Mint 工具治理路径保持兼容     | DS-007     | TP-005/006 | PASS   |
| AC-009 | Node 工具运行示例可执行       | DS-006     | TP-004/006 | PASS   |

## TP 追溯

| TP     | 目标                           | AC                 | 状态   | 执行记录                                                     |
| ------ | ------------------------------ | ------------------ | ------ | ------------------------------------------------------------ |
| TP-001 | 可移植包、ReAct 核心和示例     | AC-001/002/003/005 | 已完成 | Package build/test/import/pack 通过                          |
| TP-002 | Mint adapter 与兼容回归        | AC-004             | 已完成 | Mint 回归和 Server typecheck 通过                            |
| TP-003 | 集成验证、Harness 与证据回写   | AC-001~005         | 已完成 | Harness run `2026-10-08T07-59-31-127Z-64380` 所有 claim PASS |
| TP-004 | 创建独立 Tool Runtime 包       | AC-006/007/009     | 已完成 | Package build/test/tarball smoke/pack 通过                   |
| TP-005 | Mint Tool Runtime adapter 接入 | AC-008             | 已完成 | Mint tool regression 125 tests/typecheck 通过                |
| TP-006 | 工具安全回归与 Harness 验收    | AC-006~009         | 已完成 | Harness run `2026-10-08T08-46-46-365Z-97989` 所有 claim PASS |

## 偏差表

| 日期 | 类型 | TP  | 文件/主题 | 原因           | 影响 | 后续动作 |
| ---- | ---- | --- | --------- | -------------- | ---- | -------- |
| —    | —    | —   | —         | 当前无实现偏差 | —    | —        |

## 执行记录

### 初始化

- 状态：已完成；TP-001 至 TP-006 完成。
- 产出：SDD 文件、`@mint/react-runtime` 包、Mint 适配层和 Harness 证据。
- 验证：Harness run `2026-10-08T08-46-46-365Z-97989` 通过；AC-001 至 AC-009 PASS。
- 已知风险：现有 `reactChat` 调用图广且 GitNexus 索引过期；适配时保留兼容入口并使用当前源码及回归测试确认。

## Handoff

- 当前进度：两个通用包、Mint adapters 和验收证据已完成。
- 下一步：无。
- 阻塞：无。

### 2026-10-08：Harness run 2026-10-08T07-56-01-030Z-59325

- 状态：failed
- TP：TP-003
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T07-56-01-030Z-59325
- 检查结果：runtime-unit:passed, runtime-package-smoke:failed, claims:FAIL

### 2026-10-08：Harness run 2026-10-08T07-56-37-461Z-60322

- 状态：completed
- TP：TP-003
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T07-56-37-461Z-60322
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, mint-adapter-regression:passed, server-typecheck:passed, claims:PASS

### 2026-10-08：Harness run 2026-10-08T07-59-31-127Z-64380

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T07-59-31-127Z-64380
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, mint-adapter-regression:passed, server-typecheck:passed, claims:PASS

### 2026-10-08：Harness run 2026-10-08T08-45-53-198Z-97000

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T08-45-53-198Z-97000
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, tool-runtime-package-build:passed, tool-runtime-unit:passed, tool-runtime-package-smoke:passed, tool-runtime-package-pack:passed, mint-adapter-regression:passed, mint-tool-runtime-regression:passed, server-typecheck:passed, claims:PASS

### 2026-10-08：Harness run 2026-10-08T08-46-46-365Z-97989

- 状态：completed
- TP：TP-006
- 轮次：1
- 证据目录：.harness/runs/2026-10-08-react-runtime-package/2026-10-08T08-46-46-365Z-97989
- 检查结果：runtime-package-build:passed, runtime-unit:passed, runtime-package-smoke:passed, runtime-package-pack:passed, tool-runtime-package-build:passed, tool-runtime-unit:passed, tool-runtime-package-smoke:passed, tool-runtime-package-pack:passed, mint-adapter-regression:passed, mint-tool-runtime-regression:passed, server-typecheck:passed, claims:PASS
