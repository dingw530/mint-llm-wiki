# 追溯总览

变更名称：2026-09-11-server-lifecycle-remediation
状态：已完成
创建日期：2026-09-11
完成日期：2026-09-13

| 需求 / 规则                                            | 设计 / API | 任务 | 状态   |
| ------------------------------------------------------ | ---------- | ---- | ------ |
| US-001、FP-001、BR-001、AC-001                         | DS-001     | TP-1 | 已完成 |
| US-002、FP-002、FP-003、BR-002、BR-003、AC-003、AC-004 | DS-002     | TP-2 | 已完成 |
| US-003、FP-005、BR-004、BR-005、AC-005、AC-006         | DS-003     | TP-3 | 已完成 |
| FP-004、FP-006、BR-006、AC-002、AC-007、AC-008         | DS-004     | TP-4 | 已完成 |
| NF-001～NF-004、BR-007、AC-004、AC-008、AC-009         | DS-005     | TP-5 | 已完成 |

## 执行记录

- 2026-09-11：开始 TP-1。基线 `typecheck`、`harness:test`、`test:engineering` 通过；GitNexus 索引落后 HEAD 4 个提交，关键入口影响分析结合源码搜索确认。
- 2026-09-11：完成 TP-1～TP-4。新增 `ServerRuntime` 统一管理 HTTP、AgentRun、后台 worker、MCP、Langfuse、SQLite；定向验证 5 个测试文件、15 个测试全部通过；首次错误的绝对路径筛选命令已按 workspace 约定修正，不构成代码失败。
- 2026-09-11：完成 TP-5。Harness run `2026-09-11T10-46-00-659Z-90393` 的 unit、browser-ac、coverage、boundary 全部通过；项目级 typecheck、全量测试（server 92 文件/817 passed、client 69 passed、agent-eval 53 passed）、engineering tests、lint、build、verify:source 全部通过。
- 2026-09-13：按 Evidence Contract 重新实现并验证生命周期闭环。修复 Memory `setImmediate` shutdown race、Wiki active worker drain、HTTP 先停止新连接后 drain、关闭超时 timer 清理，并新增 `RuntimeMode/ListenMode`、integration、SIGTERM、Docker、Electron smoke 探针。
- 2026-09-13：Harness run `2026-09-13T13-51-51-717Z-7598` 完成；unit 838/838、coverage、boundary、lifecycle-integration、signal-smoke、docker-smoke、electron-smoke 全部通过，AC-001～AC-009 claim status 全部为 `PASS`。

## 偏差记录

| 日期       | 类型     | TP             | 文件                                                                                                           | 原因                                                                                                            | 影响                            | 后续动作                                        |
| ---------- | -------- | -------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| 2026-09-13 | 行为修正 | TP-3/TP-4/TP-5 | `server/services/api/memoryJobService.ts`、`server/services/jobs/jobQueue.ts`、`server/runtime/`、`Dockerfile` | Evidence Contract 验证暴露原实现未等待 active/scheduled work，且 Docker 运行阶段缺少 workspace 构建与服务端依赖 | 关闭顺序和容器启动/退出证据补齐 | 保留真实 integration/process-smoke 作为发布门禁 |

## 验收矩阵状态

| AC     | 证据                                                              | 状态   |
| ------ | ----------------------------------------------------------------- | ------ |
| AC-001 | unit：无 import 副作用不变量                                      | 已验证 |
| AC-002 | lifecycle-integration + docker-smoke：单启动、显式监听模式        | 已验证 |
| AC-003 | unit：幂等启动/关闭、bounded timeout                              | 已验证 |
| AC-004 | lifecycle-integration：启动失败回滚                               | 已验证 |
| AC-005 | lifecycle-integration + signal-smoke：停止新任务、drain、资源释放 | 已验证 |
| AC-006 | lifecycle-integration：worker/HTTP/MCP/Langfuse/timer/SQLite 顺序 | 已验证 |
| AC-007 | electron-smoke：Electron bundle 启动、请求、关闭                  | 已验证 |
| AC-008 | docker-smoke：构建、请求、SIGTERM、退出、端口释放                 | 已验证 |
| AC-009 | unit + boundary：工程回归                                         | 已验证 |

### 2026-09-11：Harness run 2026-09-11T10-46-00-659Z-90393

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-11-server-lifecycle-remediation/2026-09-11T10-46-00-659Z-90393
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed

### 2026-09-13：Harness run 2026-09-13T13-51-51-717Z-7598

- 状态：completed
- TP：TP-3、TP-4、TP-5
- 证据目录：.harness/runs/2026-09-11-server-lifecycle-remediation/2026-09-13T13-51-51-717Z-7598
- 检查结果：unit:passed, browser-ac:passed, coverage:passed, boundary:passed, lifecycle-integration:passed, signal-smoke:passed, docker-smoke:passed, electron-smoke:passed
- Claim 聚合：AC-001～AC-009 全部 `PASS`
