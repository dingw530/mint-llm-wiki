# 模型端点管理领域迁移

日期：2026-10-04。基线：`41615ff`。本批承接 Server 目录提案的后续领域迁移，不改变 schema、API、SSE、IPC 或产品行为。

## 范围与选择

模型端点管理拥有端点 CRUD、激活选择、密钥加密/脱敏、连接验证标记及旧设置迁移。服务与仓储分别进入领域层和 infrastructure；模型联网验证与提供商实现留在原有适配层，本批不迁移整个 settings 或 Agent Runtime。

GitNexus 1.6.12 已在当前 checkout 更新索引。文件 impact 为 endpointService LOW、endpointRepository MEDIUM；仓储实际生产消费者为端点服务和 settings。settings 的 get/save 为 LOW，getAiSettings 为 CRITICAL（42 impacted symbols、13 direct callers、14 processes），涉及消息、eval 和工具执行。因此 settings 只替换端点访问能力，不修改配置拼装、解密、默认值或回退分支。图谱存在全局流程采样截断和个别错误的跨语言调用解析，完整引用范围以 TypeScript 解析边界、源码字面量盘点及测试共同验证。

## 路径与边界

| 原路径                                      | 新路径                                                           |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `apps/server/services/api/endpointService.ts`    | `apps/server/domains/model-endpoints/model-endpoint-service.ts`       |
| `apps/server/repositories/endpointRepository.ts` | `apps/server/infrastructure/persistence/model-endpoint-repository.ts` |

公共入口为 `domains/model-endpoints/index.ts`。领域只依赖自己的仓储、Server 类型契约和既有 encryption 纯工具；其他生产模块不得直接访问仓储或领域内部文件。沿用小领域现有的直接仓储调用模式，不新增 bootstrap 或 DI 框架。源文件使用 kebab-case，未迁移文件不批量改名。

更新 modelEndpoints HTTP/IPC 描述符、Electron 的 `endpointService` namespace、settings 应用服务及相关测试导入。Electron 导出名称和声明式端点 ID 不变。仓储使用类型化 SQLite prepare 替代行结果断言，SQL 和结果映射保持原样。

新增 `syncLegacyEndpointSettings` 兼容入口，委托原有部分字段更新。settings 仍决定需要同步的字段并加密 API key；不会新增 CRUD 输入校验或清除 verifiedAt。真实 SQLite 用例确认同步后密钥可解密、验证标记和激活状态保持、其他端点不被改写。

混合 repository 测试文件还覆盖知识图谱和 routing，因此保留原位置，不强行搬迁整个测试文件。新自动边界测试检查实际 static imports、re-exports、literal dynamic imports，并包含禁止深层导入、禁止直接仓储访问及 infrastructure 反向依赖用例。

## 验证记录

- Server typecheck 通过。
- focused suites：15 文件、178 项通过，覆盖端点/仓储、settings、模型连接、HTTP/IPC、消息/ReAct 及全部架构边界。
- 完整 `npm run verify:source` 通过：Server 1101 项通过/16 项跳过、Client 90 项通过、eval 57 项通过；工程测试、类型检查、lint 及全部 workspace 构建通过。使用隔离 DB，并允许 HTTP 测试监听 loopback。
- Electron server bundle 通过；实际载入生成 bundle，`endpointService` namespace 的 list/create/update/getActiveEndpoint/markVerified/兼容同步导出 smoke 通过。生产旧路径引用盘点没有剩余项。
- 两个源文件的候选提交以默认 rename detection 识别为 89% / 92% rename；默认 `git log --follow` 均追回原有 5 次提交，缺失数为 0。探针只使用临时 index/object directory，没有修改真实 index、HEAD 或 refs，正式提交时仍需核对真实提交链。
- 增量 GitNexus 曾把新测试边界函数误关联至 832 条流程；无缓存全量重建后该函数 context 正确显示没有生产调用方/执行流程。重新执行变更分析：whole-worktree 17 files/29 symbols、临时 scoped index 12 files/21 symbols，均识别 113 affected processes、CRITICAL。全局流程采样依然有截断提示，未将其风险视为 LOW 或以边界函数的零调用代替 settings 高风险审查；实际入口及回归由解析边界、静态路径盘点与完整 source profile 补证。
- 保留既有 WriteFileTool、eval 报告/版本索引、Codex plugin/MCP 配置与目录、插件文档和三个文档索引；记录这些文件的内容 hash 作为验收基线。本批尚未提交。
