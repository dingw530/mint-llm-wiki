# SDD 操作细则

主技能只保留入口和关键规则；以下内容按需要读取。

## Check-doc：文档评审

不修改文档，输出评审报告和评级。检查：

- 结构完整性：文件、模板、精简模式说明。
- 追溯链路：ID 引用、孤立项、traceability 同步。
- 信息质量：填充率、“待确认”残留、验收可验证性。
- SPEC 可判定性：术语、枚举、字段、空值、时间、错误 contract、反例。
- 方案决策：完整模式是否有方案对比和明确决策。
- 偏差记录：traceability 的后续动作是否已落实到 design-doc、product-spec 或新变更。

按短板评级：A 全部通过；B 少量改善；C 多维度不达标；D 关键缺失。

## Pipeline

固定顺序：

```text
spec → design → plan → apply → verify → check-doc → archive
```

支持 `spec→verify`、`plan→archive` 等范围展开。仅 L2 默认使用：

1. 首个写入阶段创建 `docs/changes/YYYY-MM-DD-{主题}/`。
2. 后续阶段复用同一变更目录。
3. 前一阶段失败则终止后续阶段并报告阻塞。
4. 每完成一个 TP，立即更新 exec-plan 和 traceability。
5. 所有验收证据通过后才进入归档。

### Evidence-first completion gate

阶段完成前必须完成以下聚合检查：

```text
AC statement → invariant → probe → evidence artifact → AC status
```

仅有测试命令成功不等于证据充分。`apply` 可以记录局部通过，但 `verify` 必须把证据不足的 AC 标记为 `UNVERIFIED`，不能提前改成 `PASS`。

## Goal 详细规则

### 启动预算

| 阶段 | Claude Code | Codex |
|---|---:|---:|
| spec/design/plan/check-doc | 约 15 turns | 约 30k tokens |
| apply/verify | 约 30 turns | 约 60k tokens |
| pipeline | 约 50 turns | 约 100k tokens |

Claude Code 启动示例：

```text
/goal {stage} for {主题} according to /sdd-doc-generator rules. Stop when criteria met or ~{N} turns.
```

Codex 启动示例：

```text
create_goal(objective: "{stage}: {主题}，完成条件: {完成标准}", token_budget: N)
```

### 进度与阻塞

每轮末尾：

```text
=== Progress ===
Stage: {当前阶段}
Done: {已完成事项}
Pending: {待完成事项}
Blockers: {阻塞项；无则写“无”}

=== Criteria Check ===
[PASS/FAIL] {条件} — {证据}

=== Next Action ===
{下一步操作 / 已完成}
```

Claude Code 由 Haiku 读取进度区块；Codex 自检全部 PASS 后才执行 `update_goal(complete)`。验收矩阵存在 FAIL、未验证项或审计能力降级时不得完成。

### 阶段完成标准

| 阶段 | 完成条件 |
|---|---|
| spec | product-spec 创建，必填章节齐全，质量闸门通过，无关键“待确认” |
| design | design-doc 创建，方案/决策/DS 追溯完整，验收证据矩阵建立 |
| plan | exec-plan 创建，TP 初始化为“待启动”，继承证据矩阵 |
| apply | 全部 TP 完成，执行记录完整，矩阵逐项更新，self-check 通过 |
| verify | consistency + convention 报告完成或记录降级；每条 AC 的 requiredEvidence 和 invariants 均满足；矩阵无 FAIL/UNVERIFIED 项 |
| pipeline | 各阶段依次通过并完成 archive |

## 追溯、执行与偏差

追溯链：

```text
product-spec              design-doc              exec-plan
US/FP/BR/AC/NF ─────────> DS/API ──────────────> TP
```

开始实现前将 traceability 状态改为“执行中”，TP 初始化为“待启动”。每个 TP 完成后追加执行记录，写明状态、产出文件、问题和验证结果。

代码偏离设计时，在 traceability 偏差表追加日期、类型、TP、文件、原因、影响和后续动作：

- 内部重构：仅记录。
- 行为修正：在 design-doc 末尾追加偏差补丁。
- 范围扩展：更新 product-spec 或创建新变更。

## 归档与交接

verify、check-doc 通过后：

1. traceability 改为“已完成”并填写日期。
2. 更新 product-spec/design-doc/exec-plan 快捷索引。
3. 保存审计报告。
4. 交接记录写明当前进度、下一步、阻塞/风险和关键决策。
5. 若变更关联技术债务，确认债务状态与 AC/证据一致；不得留下“已实现但关联债务仍待开始”的矛盾状态。

存在 FAIL、未验证项或未处理阻塞时，不得标记完成。
