# Mint Harness

独立于 `sdd-doc-generator` 的运行时反馈层。它读取 `docs/changes/<change-id>/` 下的 SDD 产物，执行显式检查，并保存测试—修改—测试循环的证据。默认浏览器检查读取当前变更的 `browser-scenarios.json`，只执行绑定到当前 Spec AC 的外部 `playwright-cli` 场景，不要求把 Playwright 或 Electron 绑定为项目依赖。

L2 变更应在同一目录提供 `verification-plan.json`，声明每条 AC 的 `requiredEvidence` 和 probe。配置了验证计划时，Harness 会聚合 AC 级别的 `PASS`、`UNVERIFIED`、`FAIL` 或 `BLOCKED`；命令 exit code 全部为 0 但证据等级不足时，verify 仍失败。没有验证计划的历史变更进入 legacy 模式，只有显式传入 `--allow-legacy` 才允许命令返回 completed。

## 命令

```bash
npm run harness:test
npm run harness:inspect -- --change 2026-07-24-harness-feedback-loop
npm run harness:check -- --change 2026-07-24-harness-feedback-loop --dry-run
npm run harness:verify -- --change 2026-07-24-harness-feedback-loop
npm run harness:loop -- --change 2026-07-24-harness-feedback-loop --dry-run
```

运行浏览器检查前，需要先启动项目 dev 模式：

```bash
npm run dev
```

也可以单独运行浏览器检查，支持 `HARNESS_BROWSER_URL` 覆盖前端地址：

```bash
HARNESS_BROWSER_URL=http://localhost:5800 npm run harness:browser -- --change 2026-07-24-harness-feedback-loop
```

调试历史变更可以显式允许 legacy 验证，但不得将其作为完整规格验收证据：

```bash
node .harness/cli.mjs verify --change <change-id> --allow-legacy
```

编辑器通过 JSON 数组注入，避免把失败输出拼进 shell：

```bash
npm run harness:loop -- \
  --change 2026-07-24-harness-feedback-loop \
  --allowed-paths '["client/src/features/chat/"]' \
  --edit-command '["node","scripts/harness-editor.mjs"]'
```

检查项也可以通过 `--checks '[{"name":"unit","command":"npm","args":["run","test:client"],"evidenceLevel":"unit","invariants":["regression_free"]}]'` 注入；生产使用时建议把检查项、证据等级、不变量和允许路径放入受版本控制的配置文件。

编辑器可读取：

- `HARNESS_TASK_FILE` — 当前任务的 JSON 定义
- `HARNESS_FAILURE_FILE` — 包含 `{ iteration, results, structuredFailures }` 的结构化失败报告。其中 `structuredFailures` 是 `[{ file, name, error, location }]` 格式，供 AI 直接解析以定位失败的测试文件和断言。
- `HARNESS_ITERATION` — 当前 LOOP 轮次（从 1 开始）

运行证据位于 `.harness/runs/<run-id>/`。使用 `--writeback` 才会把摘要追加到 SDD 的执行记录。

## 检查项

`config.json` 中预置了四个检查项：

| 名称         | 命令                                             | 用途                                                                                                                       |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `unit`       | `node scripts/test-runner.mjs`                   | 运行 Vitest 单元测试，输出结构化 JSON 报告。失败时在迭代目录写入 `<check>-failures.json`，包含文件路径、测试名和断言差异。 |
| `browser-ac` | `node .harness/browser-scenario.mjs`             | 运行浏览器场景验证 AC                                                                                                      |
| `coverage`   | `npm run --workspace=server test:coverage:check` | 运行 vitest --coverage 检查覆盖率阈值                                                                                      |
| `boundary`   | `npm run --workspace=server test:boundary`       | 运行架构层级边界测试                                                                                                       |

### 测试自修复闭环

当 `unit` 检查失败时，Harness LOOP 自动：

1. 从 `scripts/test-runner.mjs` 的结构化 JSON 输出中提取 `structuredFailures`（每项含 `file`、`name`、`error`、`location`）
2. 合并到 `HARNESS_FAILURE_FILE` 中
3. 调用编辑器（`edit-command`）时，AI 可读取该文件直接定位失败的测试文件、行号和断言差异

```bash
npm run harness:loop -- \
  --change 2026-07-26-my-change \
  --allowed-paths '["server/services/tools/"]' \
  --edit-command '["node","scripts/harness-editor.mjs"]'
```

## 浏览器场景协议

涉及 UI 或用户流程的变更必须在变更目录提供 `browser-scenarios.json`。场景至少声明 `id`、`acceptanceCriteria`、`route`、`setup.routes` 和 `steps`，并把每条场景绑定到当前 SDD 的 AC。

`steps` 使用面向用户的 Playwright 交互：

- `fill` / `press` / `click`：通过 `role`、`testId`、`placeholder`、`label` 或文本定位真实控件。
- `waitFor`：等待用户可见的状态或控件，不使用固定 sleep。
- `assertText` / `assertNotText`：断言状态变化；折叠内容必须先执行 `click` 再断言。
- `assertRequests`：校验 UI 操作产生的关键 HTTP 方法、路径和响应状态。
- `assertLayout`：通过真实浏览器几何信息断言布局，支持 `alignedTop`、`alignedLeft`、`sameWidth`、`sameHeight` 和 `withinViewport`。
- `assertScreenshot`：保存当前截图；提供 `baseline` 时比较 PNG 像素差异，可配置 `pixelThreshold` 和 `maxDiffPixels`。
- `screenshot`：显式保存截图；每条场景成功后也会自动保存最终截图。

场景应尽量声明完整的 API mock，并通过 `assertRequests` 校验关键请求，防止测试意外依赖本地真实数据。每个场景还会自动记录 tracing、console、network、失败截图和 snapshot；`run-code` 中的 Playwright 断言错误也会被 Harness 识别为失败。

场景还可以声明视觉配置：

```json
{
  "visual": {
    "screenshot": { "filename": "chat.png", "fullPage": true },
    "layout": [
      {
        "name": "同一行控件顶部对齐",
        "type": "alignedTop",
        "targets": [{ "label": "字段 A" }, { "label": "字段 B" }],
        "tolerancePx": 1
      }
    ]
  }
}
```

成功截图和失败截图都写入 `.harness/runs/<change-id>/<run-id>/browser-ac/<scenario-id>/`。截图基线必须放在当前变更目录内，并通过 `assertScreenshot` 的 `baseline` 显式启用；没有基线时，截图作为可审阅证据保存，不会把环境差异误判为失败。

场景应覆盖完整闭环：进入页面 → 用户输入 → 提交 → 等待异步 UI 状态 → 用户确认/拒绝 → 等待最终状态 → 校验关键请求与页面结果。静态 `markers` 只能作为页面启动健康检查，不能替代交互步骤。
