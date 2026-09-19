---
name: sdd-doc-generator
description: 渐进式需求开发流程：按需求规模选择直接实现、轻量记录或完整 SDD。
argument-hint: '[discuss|quick|spec|design|plan|apply|verify|check-doc|archive|pipeline|goal] [主题] [+约束]'
allowed-tools: 'Read, Write, Bash'
user-invocable: true
---

# sdd-doc

按“最小必要流程”处理需求：先澄清，再按规模分流。简单需求直接完成，复杂需求使用可追溯的 SDD。

## 命令

```text
/sdd-doc-generator [discuss|quick|spec|design|plan|apply|verify|check-doc|archive|pipeline|goal] [主题] [+约束]
```

| 命令                        | 用途                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `discuss 主题`              | 复述需求、提出澄清问题、对齐范围和验收；不写文档、不改代码 |
| `quick 主题`                | L0：直接修改并定向验证，不生成三件套                       |
| `spec 主题`                 | 生成 product-spec                                          |
| `design 主题`               | 生成 design-doc                                            |
| `plan 主题`                 | 生成 exec-plan                                             |
| `apply 主题`                | 按文档实现；没有文档时先分流                               |
| `verify 主题`               | 审计实现与文档的一致性，聚合证据并输出逐 TP/AC 差异报告       |
| `check-doc 主题`            | 检查文档完整性和追溯链路                                   |
| `archive 主题`              | 归档已完成的 L2 变更                                       |
| `pipeline 阶段1→阶段2 主题` | 串联 L2 阶段，支持范围展开                                 |
| `goal 阶段 主题`            | 自主执行指定阶段；可使用 `goal quick`                      |

自然语言映射：讨论/澄清 → `discuss`；简单修复/小改动 → `quick`；需求/验收 → `spec`；方案 → `design`；计划 → `plan`；实现 → `apply`；审计 → `verify`。

## 不可跳过的步骤

1. 阅读用户需求和项目级 `AGENTS.md`。
2. 用一句话复述背景、目标、范围和预期产出。
3. 只询问会改变实现或验收的问题；至少确认范围和完成标准。
4. 将模糊词转换为可观察的验收条件；未知信息写“待确认”，不得脑补。
5. 判断 L0/L1/L2 后再执行对应流程。
6. 真实记录验证命令、结果、未验证项和风险。

统一验收契约：每条 AC 都必须声明风险等级、可验证不变量、最低证据等级和对应 TP/probe。命令 exit code 通过只能证明 probe 通过，不能直接证明 AC 已验证；证据等级不足时必须标记为“未验证”。

用户已明确要求实现且需求可判定时，不额外制造文档确认轮次。

## 规模分流

| 级别 | 判断信号                                                                    | 默认流程                                               |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| L0   | 明确 bug、配置/文案/样式、小型兼容修复；路径单一，通常 1–3 个文件，无新契约 | 澄清 → 修改 → 定向验证                                 |
| L1   | 小功能或小接口；少量跨模块改动，方案明确                                    | 澄清 → 实现 → 验证                                     |
| L2   | 新模块、外部系统、schema/公开 API、权限安全、多方案、跨团队或高风险改动     | 澄清 → spec → design → plan → apply → verify → archive |

分流规则：

- L0 使用 `quick`，不创建 `product-spec`、`design-doc`、`exec-plan` 或 `traceability.md`。
- L1 不强制生成文档；最终结果必须保留目标、范围、验收、验证和风险。
- L2 或用户明确要求完整 SDD 时，读取 [full-sdd.md](references/full-sdd.md)。
- 涉及验收、审计或 `verify` 时，读取 [verification.md](references/verification.md)。
- 编写文档、处理复杂规则或转换非结构化需求时，读取 [methodology.md](references/methodology.md)。
- 需要 `pipeline`、`goal`、`check-doc`、执行偏差或归档细节时，读取 [operations.md](references/operations.md)。
- 实现中发现影响范围超过当前级别时，暂停并升级。

## 各阶段关键步骤

- `discuss`：复述 → 澄清 → 对齐范围和完成标准。
- `quick`：定位影响范围 → 修改 → 最小相关测试/构建 → 报告风险。
- `spec`：提炼目标、范围、约束、用户故事、业务规则和验收标准。
- `design`：记录约束、方案取舍、最终决策、接口、责任边界和验收证据矩阵；实现名称可以调整，但责任和观测点不能丢失。
- `plan`：拆分可执行 TP，关联 DS/AC，初始化状态和验证方式；每个 TP 必须绑定可执行 probe 和证据产物。
- `apply`：逐 TP 实现；同步执行记录、追溯关系和偏差。
- `verify`：按矩阵验证功能、设计一致性、规范和 scope 偏差；先聚合 probe/evidence，再判定 AC；需要交付审查记录时，按 `references/verification.md` 输出逐 TP/AC 差异报告。
- `check-doc`：检查文档结构、内容质量、ID 引用和追溯链，并检查 AC 的风险/不变量/证据契约和 TP-probe 绑定。
- `archive`：仅在所有 AC 为 PASS、无 UNVERIFIED/FAIL/BLOCKED、关联债务已同步且证据产物存在后更新状态并刷新索引。

新增接口遵循项目端点注册规范；数据库 schema 必须使用 migration；新增方法遵循项目注释和类型约定。

## Goal 模式

Goal 模式必须先完成需求澄清，再启动自主循环。平台驱动不同，但完成标准一致：

| 环境        | 启动方式                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | 输出 `/goal {stage} for {主题} according to /sdd-doc-generator rules. Stop when criteria met or ~{N} turns.`，由 Haiku 评估器检查进度 |
| Codex       | 执行 `create_goal(objective: "{stage}: {主题}，完成条件: {完成标准}")`；完成后 `update_goal(complete)`，阻塞时 `update_goal(blocked)` |

每轮都输出 `=== Progress ===`、`=== Criteria Check ===` 和 `=== Next Action ===`。所有条件 PASS 且无 FAIL/未验证项时才算完成；同一操作失败两次换策略，连续三次失败或陷入循环则标记 blocked。详细阶段标准、预算和报告格式见 [operations.md](references/operations.md)。

## 输出

先说明结果，再列出改动范围、验证结果、未验证项和风险。L0/L1 不宣称完成完整 SDD 审计。
