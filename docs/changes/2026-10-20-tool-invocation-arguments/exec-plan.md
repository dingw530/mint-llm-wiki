# 执行计划：工具参数对账记录

## 完成定义与范围

代码完成参数原子持久化和显式读取；格式与静态检查有记录。AC 行为验收须有 integration 证据，不能用类型检查替代。

前置条件：现有 Ledger、迁移 33、AI_CHAT_ENCRYPTION_KEY。保护用户已有未提交改动，不新增公开端点。

## TP-001：实现持久化与读取

- 状态：AC 通过。
- 关联：US-001、FP-001/002、BR-001…004、NF-001、AC-001…004、DS-001…003。
- 产出：migrations/index.ts、infrastructure/persistence/tool-invocation-repository.ts、application/agent-runtime/tool-execution-service.ts。
- 步骤：迁移 34；首次 claim 加密保存；显式 getArguments；调用服务传入完整原始参数。
- 风险：迁移入口 CRITICAL，采取追加可空列；参数含秘密，保持通用日志不新增明文。
- 检查：harness:inspect；服务端 tsc --noEmit；修改文件 Prettier；git diff --check。
- 行为探针：真实 SQLite 覆盖完整参数往返、执行前持久化、写入失败拒绝执行、旧行兼容、快照不可覆盖、重启未知不重放。Harness run `2026-10-20T09-55-52-043Z-54633` 通过。

## TP-002：接入 get_tool_invocation

- 状态：AC 通过。
- 关联：US-002、FP-003、BR-005…007、AC-005…007、DS-004。
- 产出：application/tools/agents/get-tool-invocation-tool.ts、bootstrap/tool-registry.ts、application/agent-runtime/tool-catalog-service.ts。
- 检查：Harness inspect、服务端 typecheck、Prettier、git diff --check。
- 行为探针：注册与模型可见性；同会话读取；跨会话和无归属拒绝；直接 execute 再鉴权；默认不解密；原文及旧记录状态；未知状态保持不变。Harness run `2026-10-20T09-55-52-043Z-54633` 通过。

## TP-003：在恢复上下文重建未决工具调用

- 状态：AC 通过。
- 关联：US-003、FP-004、BR-008…011、AC-008…010、DS-005/006。
- 产出：`apps/server/application/agent-runtime/agent-run-recovery-service.ts`、`apps/server/application/conversations/message-service.ts` 和 recovery integration tests。
- 验证：原 callId/工具名/原参数进入 assistant tool-call；合成 role=tool 结果传达 originalRunId、outcome_unknown、无结果存储及外部状态未核实；参数不可用时标记 placeholder 并禁止重试；不改原 Ledger 状态。
- 额外验证：Ledger succeeded 时列表隐藏 retry；服务端拒绝绕过 UI 的 retry 请求；继续运行显示只读核对指引。

## 验收证据矩阵

| AC     | TP     | probe                                        | 状态 |
| ------ | ------ | -------------------------------------------- | ---- |
| AC-001 | TP-001 | invocation-arguments-integration             | PASS |
| AC-002 | TP-001 | invocation-arguments-integration             | PASS |
| AC-003 | TP-001 | invocation-arguments-integration             | PASS |
| AC-004 | TP-001 | invocation-arguments-integration             | PASS |
| AC-005 | TP-002 | invocation-query-integration                 | PASS |
| AC-006 | TP-002 | invocation-query-integration                 | PASS |
| AC-007 | TP-002 | invocation-query-integration                 | PASS |
| AC-008 | TP-003 | recovery-transcript-integration              | PASS |
| AC-009 | TP-003 | recovery-transcript-integration              | PASS |
| AC-010 | TP-003 | recovery-transcript-integration + browser-ac | PASS |

## 执行记录

- 2026-10-20：需求与设计已记录；GitNexus 影响分析已完成。TP-001 待启动。
- 2026-10-20：Harness inspect 通过；TP-001 开始实现。
- 2026-10-20：TP-001 代码完成。迁移 34 增加可空密文列；仓库首次 claim 在事务内加密完整参数；getArguments 显式解密读取；ToolExecutionService 复制 Tool Call 并传入完整参数。重试、冲突、finish 和恢复状态转换均不改写快照。
- 2026-10-20：`npm run typecheck --workspace=apps/server` 通过（含两个 runtime 包的前置构建）；本次修改的三份 TS 与变更目录 `npx prettier --check` 通过；`git diff --check` 通过。文档初次格式检查失败后已用 Prettier 修复并重查通过。
- 2026-10-20：迁移测试更新至 34 条后通过；定向测试 14/14 通过；Harness unit 1,222/1,222、coverage、boundary、lifecycle-integration、signal-smoke、electron-smoke 和两个 integration probes 通过。Harness AC-001…007 均为 PASS，证据位于 `.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T09-55-52-043Z-54633/`。
- 2026-10-20：默认完整检查中的 docker-smoke 已尝试，但本机 Docker daemon 不可用；最终通过的 Harness 命令排除该环境项，其余默认检查和 AC probes 均运行。未归档，等待 Docker 环境可用后补跑该项。
- 2026-10-20：按用户追加需求补 get_tool_invocation。TP-002 开始，扩展规格、设计和验收契约。
- 2026-10-20：TP-002 实现完成。新增 get-tool-invocation-tool.ts，并修改 bootstrap/tool-registry.ts 和 tool-catalog-service.ts；未修改持久化仓库、迁移或用户其他改动。工具在权限和执行入口核对持久化运行归属；默认不解密，显式返回参数时区分 available/missing/unavailable；目标调用保持只读。
- 2026-10-20：TP-002 定向集成测试 5/5 通过，包含目录可见性、当前会话授权、显式解密和未知状态保持；最终 Harness AC-005…007 全部 PASS。
- 2026-10-20：TP-003 通过。successor 上下文自动包含原 tool-call/参数及 unknown tool-result；没有历史快照时用明确标记的 `{}` 占位并阻止直接重试。定向恢复测试与 message-service tests 29/29 通过。
- 2026-10-20：Harness run `2026-10-20T13-06-34-209Z-17449` 完成，AC-001…010 全部 PASS；unit 1,226/1,226、coverage、boundary、lifecycle、signal、Electron、browser-ac 和三个 integration probes 通过。默认 Docker smoke 因本机 daemon 不可用待补跑。
- 2026-10-20：最终 unit 报告 1,226/1,226 通过；Harness inspect、服务端 typecheck、Prettier 和 diff check 通过。

### 2026-10-20：Harness run 2026-10-20T09-52-01-004Z-50129

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T09-52-01-004Z-50129
- 检查结果：unit:failed, claims:UNVERIFIED

### 2026-10-20：Harness run 2026-10-20T09-53-14-277Z-52493

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T09-53-14-277Z-52493
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, docker-smoke:failed, claims:UNVERIFIED

### 2026-10-20：Harness run 2026-10-20T09-55-31-670Z-54033

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T09-55-31-670Z-54033
- 检查结果：invocation-arguments-integration:failed, claims:FAIL

### 2026-10-20：Harness run 2026-10-20T09-55-52-043Z-54633

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T09-55-52-043Z-54633
- 检查结果：invocation-query-integration:passed, invocation-arguments-integration:passed, unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, claims:PASS

### 2026-10-20：Harness run 2026-10-20T12-09-32-314Z-87296

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T12-09-32-314Z-87296
- 检查结果：invocation-arguments-integration:passed, invocation-query-integration:passed, recovery-transcript-integration:passed, unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, claims:PASS

### 2026-10-20：Harness run 2026-10-20T13-06-34-209Z-17449

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T13-06-34-209Z-17449
- 检查结果：invocation-arguments-integration:passed, invocation-query-integration:passed, recovery-transcript-integration:passed, unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, claims:PASS

### 2026-10-20：Harness run 2026-10-20T13-14-29-651Z-23838

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T13-14-29-651Z-23838
- 检查结果：invocation-arguments-integration:passed, invocation-query-integration:passed, recovery-transcript-integration:failed, claims:FAIL

### 2026-10-20：Harness run 2026-10-20T13-17-45-145Z-26655

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T13-17-45-145Z-26655
- 检查结果：invocation-arguments-integration:passed, invocation-query-integration:passed, recovery-transcript-integration:passed, unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, claims:PASS
