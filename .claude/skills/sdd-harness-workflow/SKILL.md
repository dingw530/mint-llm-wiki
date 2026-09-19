---
name: sdd-harness-workflow
description: 编排项目中的完整 SDD → 实现 → Harness 验证 → 反馈修复 → 证据回写 → 交付/归档流程。用户要求按规格实现功能、把 SDD 与测试闭环串起来、执行测试—修改—测试，或需要按 AC 做浏览器验证时使用。该 Skill 消费 sdd-doc-generator 产物，不修改 sdd-doc-generator 本身。
metadata:
  short-description: 编排完整 SDD 与 Harness 反馈闭环
---

# SDD Harness Workflow

本 Skill 将需求、规格、实现、测试和交付串成一个可追溯闭环：

```text
需求
  ↓
分流与范围确认
  ↓
SDD：spec → design → plan
  ↓
Harness inspect
  ↓
按 TP 实现
  ↓
局部测试 → Harness verify
  ↓
失败诊断 → 最小修复 → 重新验证
  ↓
writeback → traceability 完成
  ↓
交付或 archive
```

本 Skill 是编排层，不重复定义 SDD 文档规则，也不修改 `.claude/skills/sdd-doc-generator/`。

核心完成原则：Harness 负责证明规格声明，不只是运行命令。每条 AC 必须经过 `claim → probe → evidence → invariant → gate` 聚合；命令 exit code 通过不能直接将 AC 标记为 PASS。

## 工作模式

- `start <主题>`：从需求开始，完成分流、SDD 产物和 Harness 交接。
- `implement <change-id>`：读取已有 SDD，按 TP 实现，并在检查失败时自动进入有限反馈回路。
- `verify <change-id>`：执行完整 Harness 检查，按 AC 审计证据。
- `loop <change-id>`：显式运行外部 Harness LOOP；通常由 `implement` 自动触发，不要求用户逐轮确认。
- `finish <change-id>`：最终验证、证据回写、追溯关闭，并判断是否可以归档。

如果只是明确的小修复，遵循 `sdd-doc-generator` 的 L0/L1 分流，不强行创建完整 SDD。

## 变更交接协议

唯一交接键是 `change-id`。L2 或用户要求完整 SDD 时，变更目录必须包含：

```text
docs/changes/<change-id>/
├── product-spec.md
├── design-doc.md
├── exec-plan.md
├── traceability.md
└── browser-scenarios.json   # 涉及 UI/用户流程时必须提供
```

进入 Harness 前必须确认：

1. SDD 文档完整，或明确记录当前级别不需要的文档。
2. `US/FP/BR/AC/NF → DS/API → TP` 可以双向追溯。
3. `exec-plan.md` 列出局部和最终验证命令。
4. UI/用户流程 AC 有对应浏览器场景；纯后端 AC 明确记录“不适用”。
5. 场景的 `acceptanceCriteria` 只引用当前 Spec 中存在的 `AC-*`。
6. `traceability.md` 已初始化 TP 状态和执行记录。

同时确认每条 AC 已声明 risk、invariants、requiredEvidence 和 probes；缺少这些字段时只能进入文档修复，不得进入“已完成”交付状态。

Harness 任务协议包含：

```text
change-id
current TP
acceptance criteria
design decisions
task plans
checks
allowed paths
protected paths
max iterations
```

## start：建立完整交接

1. 阅读项目根 `AGENTS.md`、`.harness/README.md` 和相关 `sdd-doc-generator` 参考文档。
2. 用 `sdd-doc-generator` 完成需求分流。L2 依次执行 `spec → design → plan`。
3. 创建 `docs/changes/<change-id>/`，补齐四份 SDD 文档和追溯矩阵。
4. 涉及 UI 时创建 `browser-scenarios.json`，场景必须验证用户交互闭环，而不是只检查页面 marker。
5. 运行：

   ```bash
   npm run harness:inspect -- --change <change-id>
   ```

6. inspect 失败时先修正文档、AC/DS/TP 引用和场景绑定，不进入实现。

## implement：按 TP 实现

开始每个 TP 前：

1. 在 `traceability.md` 将 TP 标记为“进行中”。
2. 确认本 TP 的允许路径、保护路径和验收标准。
3. 修改前先做相关性检查、影响分析和现有测试基线；不要覆盖用户已有的无关工作区改动。

完成每个 TP 后：

1. 运行该 TP 的局部测试。
2. 记录产出文件、验证命令、结果、偏差和未验证项。
3. 将 TP 标记为“已完成”后再进入下一个 TP。
4. 阶段性运行：

   ```bash
   npm run harness:verify -- --change <change-id>
   ```

5. 如果验证失败，自动进入反馈回路：读取 artifact 和 structured failures，判断失败类型，在当前 TP 的允许范围内做最小修改，先重跑失败检查，再重跑完整 Harness。默认最多 3 轮，不等待用户逐轮确认。

局部测试通过只更新 probe 证据，不自动更新 AC/TP 完成状态。跨模块、并发、资源关闭、信号、端口、Docker、Electron 等行为必须有 integration 或 process-smoke 证据；mock-only 结果必须标记为证据不足。

UI 变更在浏览器验证前启动开发服务：

```bash
npm run dev
```

Harness 使用外部 `playwright-cli`，不要为了场景验证新增 Playwright/Electron 项目依赖。

## 验证前环境预检

完整验证前依次确认：

```bash
node -p "process.versions.node"
node -e "require('better-sqlite3'); console.log('better-sqlite3 ok')"
npm run harness:test
npm run harness:inspect -- --change <change-id>
```

项目要求 Node 版本以 `server/package.json.engines` 和 `scripts/with-node-version.cjs` 为准。若出现：

```text
NODE_MODULE_VERSION ... compiled against a different Node.js version
```

先按项目脚本重建原生依赖：

```bash
npm run rebuild:sqlite -w mint-server
```

不要把原生模块 ABI 错误误判为业务测试失败。

## verify：完整 Harness 验证

标准命令：

```bash
npm run harness:verify -- --change <change-id>
```

默认检查由 `.harness/config.json` 决定，通常包括：

| 检查 | 作用 |
|---|---|
| `unit` | 运行 `scripts/test-runner.mjs`，输出结构化测试报告 |
| `browser-ac` | 执行绑定当前 AC 的浏览器场景 |
| `coverage` | 运行服务端覆盖率检查 |
| `boundary` | 运行架构边界测试 |

`scripts/test-runner.mjs` 必须满足：

- 使用项目要求的 Node 版本运行 Vitest。
- 将 Vitest JSON 写入独立 `outputFile`，避免 logger 输出污染 JSON。
- 对共享 SQLite/固定端口测试使用单线程，避免并行竞态。
- stdout 最终只输出 Harness 可解析的结构化 JSON。

浏览器场景规则：

- UI AC 必须有匹配场景并通过。
- 非 UI AC 可以使用空场景，但必须记录“不适用”；“没有匹配场景”不等于 UI 功能已验收。
- 场景应覆盖进入页面、输入、提交、异步状态、最终结果和关键请求。
- 可单独运行：

  ```bash
  npm run harness:browser -- --change <change-id>
  ```

完成标准：

- 所有配置检查通过。
- 所有 UI AC 的浏览器场景通过。
- 无 scope/protected path 违规。
- SDD 执行记录和 Harness 证据目录一致。
- 没有 FAIL、UNVERIFIED、blocked 或未解释的环境失败；每条 AC 的最低证据等级和不变量均已满足；SDD 执行记录、证据目录和 traceability 一致。

### Claim-level verification

Harness 运行结束后生成 AC 聚合结果：

```text
PASS       = requiredEvidence 齐全且 invariants 全部有观察证据
UNVERIFIED = 命令通过但证据等级不足、只有 mock 或缺少关键观察值
FAIL       = 断言失败或观察值违反规格
BLOCKED    = 必需探针因环境原因无法执行
```

对生命周期、并发、事务、连接池等高风险变更，默认检查 ownership、no_new_work、drain、ordering、bounded_timeout、rollback、no_resource_leak 等不变量；项目可在变更文档中声明适用集合。

## 失败诊断顺序

Harness 失败时不要立即修改业务代码，按以下顺序处理：

1. 读取运行目录：

   ```text
   .harness/runs/<change-id>/<run-id>/
   ```

2. 先判断失败类型：

   - `runner/parser`：测试报告格式、日志污染或 Harness 脚本问题。
   - `ABI/native module`：Node 版本或 better-sqlite3 构建问题。
   - `EADDRINUSE/timeout`：测试并发、残留服务或端口配置问题。
   - `scope/protected path`：允许路径或变更范围问题。
   - `assertion/test failure`：真实业务回归。

3. 对 runner/环境问题修复验证基础设施或环境，不修改业务逻辑绕过检查。
4. 对业务失败读取结构化 `structuredFailures`，只修复当前 AC/TP 范围内的问题。
5. 重新运行最小局部检查，再运行完整 Harness。
6. 同一阻塞连续三次无法推进时停止 LOOP，报告 `blocked`，不要无限重试。

## 自动反馈回路

自动反馈回路是 `implement` 和 `finish` 的默认行为，由当前 Agent 编排，不依赖用户逐轮确认：

1. 运行当前 TP 的局部检查；跨模块或用户流程变更运行完整 Harness。
2. 读取 `.harness/runs/<change-id>/<run-id>/` 中的日志和结构化失败。
3. 环境/runner 失败先修复验证条件；不得修改业务代码掩盖环境失败。
4. 业务失败只在当前 TP 的 `allowedPaths` 内做最小修改。
5. 重跑失败检查，再重跑完整 Harness。
6. 通过则结束；失败则进入下一轮，最多 3 轮。
7. 每轮更新 `exec-plan.md` 执行记录和 `traceability.md` TP 状态。

自动回路停止条件：

- 所有检查通过：标记 `completed`。
- 缺少安全编辑范围、需要用户决策或涉及受保护路径：暂停并报告 `blocked`。
- 同一根因连续 3 轮未改善：停止并报告 `blocked`。
- 发现范围扩大到新的产品需求：暂停，更新或拆分 SDD 后继续。

## loop：显式 Harness LOOP

当项目提供可靠的外部编辑器命令，或需要 Harness 自己驱动编辑器时，可以显式执行：

```bash
npm run harness:loop -- \
  --change <change-id> \
  --allowed-paths '["server/services/api/"]' \
  --edit-command '["node","scripts/harness-editor.mjs"]' \
  --max-iterations 3
```

编辑器可读取：

- `HARNESS_TASK_FILE`
- `HARNESS_FAILURE_FILE`
- `HARNESS_ITERATION`
- `HARNESS_RUN_DIR`

安全规则：

- `allowed-paths` 必须具体，不能为空。
- 不得编辑 `.harness/`、`.claude/skills/`、测试配置和 protected paths；修改 Harness/Skill 本身必须由用户明确要求并走普通变更。
- 不自动回滚用户已有改动。
- 编辑器退出码为 0 不等于任务成功，最终状态由 Harness 检查决定。
- 达到最大轮次、编辑越界或检查持续失败时停止并报告阻塞。

## finish：证据回写与交付

所有 TP 和 AC 完成后：

1. 运行最后一次完整验证：

   ```bash
   npm run harness:verify -- --change <change-id>
   ```

2. 将验证摘要写回执行记录：

   ```bash
   npm run harness:verify -- --change <change-id> --writeback
   ```

3. 更新 `traceability.md`：

   - 状态改为“已完成”。
   - 填写完成日期。
   - 所有 AC/TP 标记为 PASS/已完成。
   - 记录证据目录、命令、结果和偏差。

4. 检查工作区，区分本变更和用户已有的无关改动；不擅自提交或删除无关文件。
5. 运行 `sdd-doc-generator verify` 或等价的一致性审计，输出逐 TP/AC 差异报告。
6. 只有不存在 FAIL、UNVERIFIED、blocked、未验证项且文档索引已同步、关联债务已同步时，才调用 `sdd-doc-generator archive`。

## 归档前检查清单

- [ ] product-spec、design-doc、exec-plan、traceability 完整
- [ ] AC/DS/TP 追溯无断链
- [ ] UI AC 有真实浏览器交互场景
- [ ] unit、coverage、boundary、browser-ac 全部通过
- [ ] Node/原生依赖环境已验证
- [ ] Harness 证据已写回 SDD
- [ ] 每条 AC 的 requiredEvidence 和 invariants 均已满足
- [ ] 不存在仅凭 mock/exit code 标记完成的 AC
- [ ] 逐 TP/AC 一致性审计已完成
- [ ] traceability 状态和完成日期准确
- [ ] 变更范围和用户已有改动已区分
- [ ] 快捷索引已更新

## 常见失败处理

- SDD 缺失：回到 `sdd-doc-generator` 补齐，不直接猜测 AC。
- inspect 失败：先修文档和追溯链路。
- browser 场景缺失：UI AC 补场景；纯后端 AC 记录“不适用”。
- dev server 未启动：启动 `npm run dev` 后重试。
- JSON 解析失败：检查 test-runner 是否将日志和 JSON 分离，不能把原始日志直接当 JSON 解析。
- Node ABI 错误：执行 `npm run rebuild:sqlite -w mint-server`。
- 端口占用/SQLite 锁：清理残留服务，或让共享资源测试单线程执行。
- scope policy 失败：检查 allowed/protected paths，不自动放宽范围。
- 业务断言失败：读取 artifact 中的结构化失败，进行最小修复并重新验证。

详细命令、证据格式和场景协议见 [.harness/README.md](../../../.harness/README.md)。
