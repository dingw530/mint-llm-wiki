# <项目名> — Agent Orientation Map

## Stack

| Layer | Tech |
| --- | --- |
| Language | <语言> |
| Frontend | <前端框架> |
| Backend | <后端框架> |
| Database | <数据库> |
| Desktop / Mobile | <可选> |
| Testing | <测试框架> |

## Architecture Layers

依赖只能向下流动，禁止逆向导入。

```text
<frontend-root>/
├── features/       → 业务模块
├── components/     → 共享组件
├── hooks/          → 自定义 hooks
├── services/       → API 客户端
└── styles/         → 设计系统

<backend-root>/
├── endpoints/      → 端点声明或注册
├── migrations/     → 数据库迁移
├── repositories/   → 数据访问层
├── routes/         → 路由处理
├── services/       → 业务逻辑与外部适配
└── __tests__/      → 测试

<platform-root>/    → Electron、移动端或部署层
```

## Core Philosophy

1. **Think Before Coding**
2. **Simplicity First**：避免为简单问题引入过度抽象
3. **Surgical Changes**：只修改当前任务涉及的最小范围
4. **Goal-Driven Execution**：先明确成功条件，再执行与验证

## Key Conventions

- 新增方法应添加 JSDoc，标明参数和返回值类型。
- 避免硬编码；样式使用设计 tokens，后端常量放在所属模块。
- 前端按 feature 组织，不按纯组件类型组织业务代码。
- 新增 API 应通过 `<端点注册机制>` 注册，避免绕过统一层。
- 流式响应统一使用 `<SSE/WebSocket>`，前端通过 `<hook/客户端>` 消费。
- 数据库 Schema 变更必须通过 migration，禁止直接修改生产结构。
- 函数不超过 `<120>` 行；过长循环或分支应提取为具名函数。
- 不得使用 `as any` 等方式绕过类型系统。
- 修改代码后必须执行格式检查与 `git diff --check`。

## Commands

```sh
# 开发
<启动命令>

# 测试
<全量测试命令>
<单文件测试命令>

# 构建
<构建命令>

# E2E / Harness
<验证命令>
```

## Documentation Map

```text
docs/
├── changes/            # 按变更组织的需求、设计与执行记录
├── product-specs/      # 产品规格索引
├── design-docs/        # 设计文档索引
└── exec-plans/         # 执行计划索引
```

## Environment

| Variable | Description |
| --- | --- |
| `<ENV_VAR>` | <说明> |
| `<ENV_VAR>` | <说明> |

## Where to Look First

| 任务 | 入口 |
| --- | --- |
| 前端入口 | `<path>` |
| 核心业务流 | `<path>` |
| API / 路由 | `<path>` |
| 数据库 | `<path>` |
| 配置 | `<path>` |
| 测试 | `<path>` |

## Constraints

- **MUST**：<必须遵守的架构或实现约束>
- **MUST NOT**：<禁止行为>
- **PREFER**：<推荐实践>
- **MUST**：修改 `<文件类型>` 后运行 `<格式化检查命令>`。
- **MUST NOT**：提交异常超长单行；提交前运行 `git diff --check`。

## Commit Convention

遵循 Conventional Commits：

```text
<type>(<scope>): <description>
```

- `type`：`feat`、`fix`、`refactor`、`test`、`docs`、`chore` 等。
- `scope`：小写模块名，可选。
- `description`：英文、祈使句、小写开头、无句号，建议不超过 72 字符。
- 一个 commit 只包含一个功能边界。
- 禁止使用 `git commit --no-verify`。

## Development Process

仅产品功能迭代执行 SDD / Harness 流程：

1. 在 `docs/changes/<change-id>/` 建立或确认产品规格、设计文档、执行计划与追溯表。
2. 开始任务前，将状态更新为“执行中”。
3. 每完成一个任务包，记录产出文件、验证结果与风险。
4. UI 或用户流程变更应补充浏览器验收场景，并绑定验收标准。
5. 完成后更新追溯状态、索引文档和交付证据。

## Code Intelligence（可选）

- 编辑符号前先进行影响分析，识别调用方、执行流程和风险。
- `HIGH`、`CRITICAL` 或 `UNKNOWN` 风险必须先核实，不能视为低风险。
- 提交前执行全量变更影响检查。
- 重命名必须使用理解调用图的工具，禁止简单全文替换。
