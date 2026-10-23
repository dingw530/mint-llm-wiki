# 追溯总览：工具调用参数对账记录

## 状态

- 变更：2026-10-20-tool-invocation-arguments
- 当前状态：AC-001…010 通过；Docker smoke 待环境验证
- 日期：2026-10-20
- 分流：L2（schema 与敏感参数持久化）

## 追溯矩阵

| 需求                                   | 设计   | 任务   | 证据状态                                           |
| -------------------------------------- | ------ | ------ | -------------------------------------------------- |
| US-001、FP-001、BR-001/002、AC-001     | DS-001 | TP-001 | PASS：invocation-arguments-integration             |
| FP-002、NF-001、AC-002                 | DS-002 | TP-001 | PASS：invocation-arguments-integration             |
| BR-003、AC-003                         | DS-003 | TP-001 | PASS：invocation-arguments-integration             |
| BR-004、AC-004                         | DS-003 | TP-001 | PASS：invocation-arguments-integration             |
| US-002、FP-003、BR-005…007、AC-005…007 | DS-004 | TP-002 | PASS：invocation-query-integration                 |
| US-003、FP-004、BR-008…010、AC-008/009 | DS-005 | TP-003 | PASS：recovery-transcript-integration              |
| BR-011、AC-010                         | DS-006 | TP-003 | PASS：recovery-transcript-integration + browser-ac |

## 执行记录

| TP     | 状态    | 文件                                                                                                                                                                          | 检查与问题                                                  |
| ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| TP-001 | AC 通过 | `apps/server/migrations/index.ts`、`apps/server/infrastructure/persistence/tool-invocation-repository.ts`、`apps/server/application/agent-runtime/tool-execution-service.ts`  | SQLite probes、全量 unit 和 coverage 通过                   |
| TP-002 | AC 通过 | `apps/server/application/tools/agents/get-tool-invocation-tool.ts`、`apps/server/bootstrap/tool-registry.ts`、`apps/server/application/agent-runtime/tool-catalog-service.ts` | 会话范围与目录 probes 通过                                  |
| TP-003 | AC 通过 | `apps/server/application/agent-runtime/agent-run-recovery-service.ts`、`apps/server/application/conversations/message-service.ts`                                             | 原 callId/完整参数配对 synthetic 结果；旧快照缺失时显式占位 |

## 偏差

- 2026-10-20：用户明确追加 get_tool_invocation；复用本变更目录扩展为 TP-002。新增只读工具入口，未扩展为自动对账。

默认 Harness 的 Docker smoke 因本机 Docker daemon 不可用。最终 Harness 命令跳过该环境项，其余默认检查及 AC probes 通过，AC-001…010 均为 PASS。待 Docker daemon 可用后补跑，不归档本变更。

- 2026-10-20：按 DeepSeek Harness 思路新增恢复 transcript 修复，原 run 与调用 ID 由服务端持有并自动注入，不要求模型从普通对话推断。新增 AC-008/009、DS-005、TP-003。
- 2026-10-20：Harness `2026-10-20T12-09-32-314Z-87296` 将 AC-001…009 全部聚合为 PASS；默认 Docker smoke 因 daemon 不可用而未运行。
- 2026-10-20：增加 Ledger succeeded 的恢复保护；AC-010 验证服务端禁 retry、恢复卡片只显示继续核对，以及点击后调用正确接口。

## 交接

当前：AC-001…010 已通过真实 SQLite integration 和 browser probes。Harness unit 1,226/1,226、coverage、boundary、lifecycle、signal、Electron 检查也通过。完整默认 Harness 的 Docker smoke 因本机 daemon 未运行而待补跑。本次未操作生产数据库，迁移会在正常启动时执行。

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
- TP：TP-001…TP-003
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T12-09-32-314Z-87296
- 检查结果：invocation-arguments-integration:passed, invocation-query-integration:passed, recovery-transcript-integration:passed, unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, claims:PASS（AC-001…010）
- 环境限制：Docker smoke 因本机 Docker daemon 不可用未包含在本次 checks 中。

### 2026-10-20：Harness run 2026-10-20T12-09-32-314Z-87296

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T12-09-32-314Z-87296
- 检查结果：invocation-arguments-integration:passed, invocation-query-integration:passed, recovery-transcript-integration:passed, unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, claims:PASS（AC-001…010）

### 2026-10-20：Harness run 2026-10-20T13-06-34-209Z-17449

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-20-tool-invocation-arguments/2026-10-20T13-06-34-209Z-17449
- 检查结果：invocation-arguments-integration:passed, invocation-query-integration:passed, recovery-transcript-integration:passed, unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, electron-smoke:passed, claims:PASS（AC-001…010）

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
