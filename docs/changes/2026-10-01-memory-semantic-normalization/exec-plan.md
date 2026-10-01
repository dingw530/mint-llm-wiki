# 执行计划：记忆语义键归一化

状态：已完成。关联：[规格](product-spec.md)、[设计](design-doc.md)、[追溯](traceability.md)。

## 完成条件与范围

AC-001～AC-004 的单元/SQLite 集成证据通过；相关回归、typecheck、边界、Electron bundle、格式检查通过。真实提供商准确率不在本次声明范围。允许 server/domains/memory、server/infrastructure/ai、server/bootstrap/memory.ts 与本变更文档；保留工作区其他改动。不新增端点或数据库迁移。

| TP     | 内容                                                                  | 状态   | DS / AC                         | probe                                                |
| ------ | --------------------------------------------------------------------- | ------ | ------------------------------- | ---------------------------------------------------- |
| TP-001 | 语义 port、Jev/LLM provider、归一化与入口注入、协议及真实 SQLite 集成 | 已完成 | DS-001～DS-003 / AC-001～AC-004 | semantic-unit、semantic-integration、semantic-static |

## 验证

`npm run harness:inspect -- --change 2026-10-01-memory-semantic-normalization`；`npm run test -w mint-server -- domains/memory infrastructure/ai/__tests__/memorySemanticClassifier.test.ts`；使用 harness-checks.json 执行 Harness verify 并 writeback；Prettier、git diff --check。

## 执行记录

- 2026-10-01：TP-001 进行中。先执行 GitNexus impact；无 schema/UI 修改，浏览器不适用。已有工作区变更不回滚。

### 2026-10-01：Harness run 2026-10-01T11-30-46-532Z-15159

- 状态：failed
- TP：TP-001
- 轮次：1
- 证据目录：.harness/runs/2026-10-01-memory-semantic-normalization/2026-10-01T11-30-46-532Z-15159
- 检查结果：semantic-unit:passed, semantic-integration:failed, claims:FAIL

### 2026-10-01：Harness run 2026-10-01T11-32-29-170Z-16926

- 状态：completed
- TP：TP-001
- 轮次：1
- 证据目录：.harness/runs/2026-10-01-memory-semantic-normalization/2026-10-01T11-32-29-170Z-16926
- 检查结果：semantic-unit:passed, semantic-integration:passed, semantic-static:passed, claims:PASS

## 最终执行记录：2026-10-01

- TP-001 已完成；AC-001～AC-004 PASS。Harness run `2026-10-01T11-32-29-170Z-16926`。
- 产出：`server/domains/memory/memorySemanticPolicy.ts`、`memoryService.ts`、`memoryJobService.ts`、`types.ts`、`index.ts`；`server/infrastructure/ai/memorySemanticClassifier.ts`；`server/bootstrap/memory.ts`；领域语义单测、真实 SQLite 集成测试、provider 协议测试与原 worker 参数契约测试。
- 首轮 Harness：原 worker 测试未声明新增可选参数而失败；修复测试契约后重跑全部检查通过。
- 语义协议单测 30 个、真实 SQLite 集成 16 个；Harness 相关记忆回归全部通过，另单独通过 messageService 21 个回归。typecheck、boundary、server build、client build、Electron bundle、MCP bundle 通过；Prettier 与 git diff --check 通过。
- 修改前 GitNexus：提取、写入、任务工厂风险 LOW；全混合工作区 detect-changes 为 CRITICAL（包含用户既有改动），不是本次变更干净性声明，未提交。
- 证据等级：提供商响应受控；真实 SQLite 与真实队列处理，不依赖真实 Jev/LLM 网络服务；不声称真实语义准确率达标。不修改或迁移已有别名记忆，不涉及 UI，浏览器不适用。
