# Mint — Agent Orientation Map

## Stack

| Layer    | Tech                                    |
| -------- | --------------------------------------- |
| Language | TypeScript (全栈)                       |
| Frontend | React 18, Vite 5, CSS Custom Properties |
| Backend  | Express 4, better-sqlite3 (SQLite)      |
| Desktop  | Electron + electron-builder             |
| Testing  | Vitest 1.x                              |

## Architecture Layers

依赖只能**向下**流动，禁止逆向导入。

```
client/src/
├── features/           → 业务模块（chat/, images/, settings/）
├── components/         → 共享组件（Sidebar, WikiPanel, ConfirmDialog）
├── hooks/              → 自定义 hooks（useSSE）
├── services/           → API 客户端
└── styles/             → 设计系统 CSS（design tokens）

server/
├── endpoints/          → 声明式端点注册（自动生成路由 + IPC 处理）
├── migrations/         → 数据库迁移
├── repositories/       → 数据访问层
├── routes/             → Express 路由处理
├── services/
│   ├── adapters/       → AI API 适配器（Anthropic, OpenAI Chat/Responses）
│   ├── api/            → 业务逻辑（wiki, routing, memory）
│   ├── tools/          → AI 工具实现（Bash, Wiki, MCP 等）
│   └── utils/          → 工具函数（encryption, token estimation）
└── __tests__/          → Vitest 集成测试

electron/               → 桌面应用（main process, preload, client-dist）
```

## Core Philosophy

1. **Think Before Coding**
2. **Simplicity First**: 减少过度设计膨胀抽象，避免简单问题复杂化
3. **Surgical Changes**: 只改当前任务需要修改的，避免无关改动
4. **Goal-Driven Execution**: 给成功条件，不止给命令，避免目标模糊无法验证

## Key Conventions

- **注释规范**: 新增方法添加 JSDOC 注释，参数和返回值标注类型
- **避免硬编码**: 颜色/间距/字体使用 CSS custom properties（design tokens），后端常量抽取到对应模块
- **前端结构**: feature-based 目录组织，按功能模块划分而非组件类型
- **API 适配器**: 新增 AI 提供商时在 `server/services/adapters/` 添加适配器，实现统一的 `AIAdapter` 接口
- **端点注册**: 新增 API 端点通过 `endpoints/` 声明式注册，自动生成 Express route + Electron IPC
- **SSE 流式**: AI 响应使用 Server-Sent Events 流式传输，前端用 `useSSE` hook 消费

## Commands

```sh
# 开发
npm run dev                 # 全栈开发（server + client concurrently）
npm run dev:server          # 仅 server（tsx watch）
npm run dev:client          # 仅 client（vite）

# 测试
cd server && npm test                       # 全量测试
cd server && npm run test:coverage          # 全量测试 + 覆盖率报告（html/lcov/text）
cd server && npx vitest run __tests__/xxx   # 单文件测试

# Harness 反馈回路
npm run harness:test
npm run harness:inspect -- --change <change-id>
npm run harness:verify -- --change <change-id>
npm run harness:browser -- --change <change-id>
npm run harness:loop -- --change <change-id> --allowed-paths '["client/src/"]' --edit-command '["node","scripts/harness-editor.mjs"]'

# 构建
npm run build               # server tsc + client vite 构建

# 桌面端
npm run electron:dev        # 构建 + 启动 Electron
npm run electron:build:mac  # 打包 macOS .dmg

# 测试
cd server && npm test                       # 全量测试
cd server && npx vitest run __tests__/xxx   # 单文件测试

# CLI
cd server && npx tsx cli/index.ts           # CLI 入口
cd server && npx tsx cli/repl.ts            # 交互式 REPL
```

Harness 的详细协议、检查项、AC 浏览器场景和运行证据见 [.harness/README.md](.harness/README.md)。运行 `harness:verify` 或 `harness:browser` 前需先启动 `npm run dev`；浏览器检查使用外部 `playwright-cli`，不新增 Playwright/Electron 项目依赖。
需求到实现的完整 SDD → Harness 链路优先使用 `.claude/skills/sdd-harness-workflow/SKILL.md`；它编排现有 `sdd-doc-generator`，不修改该 Skill。

## Documentation Map

```
docs/changes/                   按 YYYY-MM-DD-业务主题/ 组织的变更文档
docs/product-specs/README.md    产品规格索引
docs/design-docs/README.md      设计文档索引
docs/exec-plans/README.md       执行计划索引
.harness/README.md               Harness 反馈回路、AC 浏览器场景和运行证据说明
```

## Environment

| 变量                                   | 说明                                      |
| -------------------------------------- | ----------------------------------------- |
| `AI_CHAT_ENCRYPTION_KEY`               | AES-256-GCM 密钥（必填）                  |
| `AI_CHAT_DB_PATH`                      | SQLite 路径覆盖（默认 `~/.mint/data.db`） |
| `PORT`                                 | 服务端口（默认 3001）                     |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | 默认 API 密钥                             |

## Where to Look First

| 任务           | 入口                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 前端入口       | `client/src/App.tsx`                                                 |
| 消息流/SSE     | `client/src/features/chat/` + `server/routes/conversations.ts`       |
| ReAct 推理循环 | `server/services/api/orchestratorService.ts` + `reactRoundEngine.ts` |
| AI 适配器      | `server/services/adapters/`                                          |
| Wiki 知识库    | `server/services/api/wikiCompiler.ts` + `wikiService.ts`             |
| 工具实现       | `server/services/tools/`                                             |
| 数据库迁移     | `server/migrations/`                                                 |
| 端点注册       | `server/endpoints/`                                                  |
| 设置/配置      | `server/routes/settings.ts` + `client/src/features/settings/`        |
| Electron 桌面  | `electron/main.js` + `electron/preload.js`                           |
| 测试           | 各源码目录下的 `__tests__/`                                          |

## Constraints (Machine-Readable)

- **MUST**: 新增 API 端点通过 `endpoints/` 声明式注册，禁止直接写 Express route
- **MUST**: AI 流式响应使用 SSE，前端使用 `useSSE` hook 消费
- **MUST NOT**: 禁止在前端硬编码 API URL，必须通过 `/api` 代理或 settings 获取
- **MUST NOT**: 禁止直接修改数据库 schema，必须通过 `migrations/` 迁移
- **MUST NOT**: 禁止硬编码
- **PREFER**: 纯函数优先，便于单元测试覆盖
- **PREFER**: CSS 设计系统 tokens（custom properties）而非内联样式
- **MUST** 封装同作用域 ≥3 个 let 为状态对象 + 工厂函数，外传前做防御性副本
- **MUST NOT** 函数超过 120 行；循环体 ≥30 行、分支 ≥20行必须提取为命名函数
- **MUST NOT** 生产代码使用 as any / as unknown as T / as T 绕过类型系统
- **MUST** 修改 TypeScript、TSX、CSS 或配置代码后执行可读性格式检查：对所有本次修改文件运行 `npx prettier --check <modified-files>`；发现格式问题必须先运行 `npx prettier --write <modified-files>` 修复
- **MUST NOT** 提交包含异常超长单行的 JSX、TypeScript、CSS 或配置代码；格式化后仍需通过 `git diff --check`

# Commit Convention

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，格式：

```
<type>(<scope>): <description>

[optional body]
```

## Type（必选）

| Type       | 含义                                 | 示例                                           |
| ---------- | ------------------------------------ | ---------------------------------------------- |
| `feat`     | 新功能                               | `feat: add image generation panel`             |
| `fix`      | 修复 Bug                             | `fix: handle SSE parse error on partial chunk` |
| `refactor` | 重构（既不修 Bug 也不加功能）        | `refactor: extract message routing to service` |
| `perf`     | 性能优化                             | `perf: lazy-load Settings modal`               |
| `style`    | 代码格式（空格、分号等，不影响逻辑） | `style: reformat with 2-space indent`          |
| `test`     | 增改测试                             | `test: add streaming edge cases`               |
| `docs`     | 仅文档变更                           | `docs: add architecture overview`              |
| `chore`    | 构建/工具/依赖                       | `chore: upgrade vite to 5.4`                   |
| `ci`       | CI 配置变更                          | `ci: add lint step to pipeline`                |

## Scope（可选）

小写，表示影响范围，如 `api`、`ui`、`db`、`sse`、`electron`、`wiki`、`tools`、`routing`。

## Description

- 英文，小写开头，无句号
- 祈使句（"add" 而非 "added" 或 "adds"）
- 不超过 72 字符

## Body（可选）

- 解释 **why** 而非 **what**（diff 已经说明了 what）
- 中英文均可，用换行分隔段落

## 示例

```
feat(ui): add theme switcher to settings modal

Users can now switch between 5 themes without reloading.
```

```
fix(sse): handle empty buffer on stream end

The SSE reader threw when the final chunk was empty.
```

```
refactor: extract endpoint service from settings route

Settings route had grown to 400 lines mixing CRUD and migration logic.
```

```
chore: bump express from 4.18 to 4.21
```

## 注意

- `feat` / `fix` 会出现在 changelog 中，`refactor` / `chore` 等不会
- 一个 commit 只做一件事。如果不同目标混在一起，拆成多个 commit
- **MUST NOT** 使用 `git commit --no-verify`。若 Hook 失败，必须修复 Hook/失败项，或手动完整执行被 Hook 覆盖的检查并记录原因后再提交；不得绕过验证。

# Development Process

仅产品功能迭代需要按以下规则维护 `docs/changes/` 下的变更文档（按变更组织，含产品规格、设计文档、执行计划）。工程质量、构建、重构、测试、配置和其他非产品功能变更不要求创建或更新这套文档：

本项目统一使用 SDD + Harness 工作流（`sdd-doc-generator`、`sdd-harness-workflow` 和相关 Codex 代理）。OpenSpec/OPSX 工作流已停用；`openspec/changes/archive/` 中的内容仅作为历史归档查询，不作为新变更入口。

## 目录结构

```
docs/
├── changes/                          # 变更主存储
│   └── YYYY-MM-DD-业务主题/           # 一个变更一个目录
│       ├── product-spec.md            # 产品规格
│       ├── design-doc.md              # 设计文档
│       ├── exec-plan.md               # 执行计划
│       └── traceability.md            # 追溯总览表
├── product-specs/README.md            # 产品规格索引视图
├── design-docs/README.md              # 设计文档索引视图
├── exec-plans/README.md               # 执行计划索引视图
└── test-plan.md                       # 全局测试计划
```

### Harness 与浏览器验收

- 每个变更以 SDD 的 AC 作为验证事实源；Harness 通过 `docs/changes/<变更标识>/` 读取任务上下文。
- 影响用户界面或用户流程的变更，应在同一变更目录增加 `browser-scenarios.json`，并将每个场景绑定到一个或多个 `AC-*`。
- 浏览器场景只验证当前 Spec 变更绑定的 AC；全局页面健康检查不能替代功能验收。
- `harness:verify` 按“检查 → AC 对应浏览器场景 → 证据记录”执行；失败后可通过 Harness LOOP 进行测试—修改—测试。
- 不修改 `.claude/skills/sdd-doc-generator/`；Harness 通过独立 adapter 消费 SDD，不改变 SDD 生成流程。

## 执行前

- 仅对产品功能迭代执行以下 SDD 文档流程；非产品功能变更跳过本节及后续文档维护步骤
- 定位当前变更的 exec-plan，确认文档在 `docs/changes/<变更标识>/exec-plan.md` 下
- 在 `traceability.md` 中将变更状态改为 **执行中**，初始化所有 TP 的执行记录为"待启动"

## 执行中

- 开始一个 TP 时：更新状态为"进行中"，更新追溯总览表
- 完成一个 TP 时：在 **执行记录** 中追加完成信息（状态、产出文件、遇到的问题）
- 文件变更（新建/修改）必须记录到对应 TP 的执行备注中

## Handoff

- 确保执行记录中当前 TP 状态准确
- 写明：当前进度、下一步要做的事、已知阻塞/风险

## 归档

- 所有 TP 完成后，变更状态改为 **已完成**（更新 `traceability.md` 中的状态字段和完成日期）
- 同步更新关联的 design-doc 和 product-spec 的追溯表
- 更新快捷索引：刷新 `docs/product-specs/README.md`、`docs/design-docs/README.md`、`docs/exec-plans/README.md`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **mint-ai-chat** (14452 symbols, 27719 relationships, 727 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/mint-ai-chat/context` | Codebase overview, check index freshness |
| `gitnexus://repo/mint-ai-chat/clusters` | All functional areas |
| `gitnexus://repo/mint-ai-chat/processes` | All execution flows |
| `gitnexus://repo/mint-ai-chat/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
