# 设计文档：启动与关闭生命周期整改

## 设计目标与约束

目标是把“资源创建、运行、关闭”从模块副作用和入口脚本中收敛到一个显式 runtime，同时保持现有 HTTP、IPC、Docker 和 Electron 功能契约。

约束：

- `app.ts` 必须保持可独立导入和测试。
- Node、CLI、Docker、Electron 共用服务组装逻辑，但入口模式必须显式传入。
- 不允许通过 `process.exit()` 代替资源清理。
- 不在本变更中改变数据库 schema、API payload、SSE event 或 IPC endpoint。
- runtime 关闭顺序必须避免后台任务在 SQLite 关闭后继续访问数据库。

## 方案对比与决策

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 继续在 `app.ts`/`index.ts` 中增加条件判断 | 不采用 | 继续扩大 import side effect 和入口隐式耦合 |
| 每个入口分别实现启动和关闭 | 不采用 | Node、CLI、Docker、Electron 行为容易漂移，资源顺序无法统一 |
| 引入 `createApp()` + `ServerRuntime`，入口只负责适配 | 采用 | 资源所有权集中、生命周期可测试、入口行为可显式区分 |
| 立即把所有异步任务改造成统一队列 | 不采用 | 超出本变更范围，增加数据语义和调度风险 |

## 模块设计

```text
server/app.ts                    # createApp(options)，纯 Express 组装
server/runtime/serverRuntime.ts  # runtime 状态、资源注册、start/shutdown
server/runtime/startupConfig.ts # 环境与入口模式解析
server/index.ts                  # Node 入口适配
server/cli/index.ts              # CLI 入口适配
server/docker-entry.js           # Docker 入口适配
electron/main.js                 # Electron 入口适配
```

建议契约：

```ts
type RuntimeState = 'created' | 'starting' | 'running' | 'stopping' | 'stopped';
type RuntimeMode = 'node' | 'cli' | 'docker' | 'electron';
type ListenMode = 'loopback' | 'container' | 'external';

interface ServerRuntime {
  readonly state: RuntimeState;
  readonly port?: number;
  start(): Promise<void>;
  shutdown(reason?: string): Promise<void>;
}

interface ServerRuntimeOptions {
  mode: RuntimeMode;
  listenMode: ListenMode;
  preferredPort?: number;
  clientDist?: string;
}
```

具体命名可以在实现阶段按现有模块结构调整，但不能改变上述责任边界。

## 启动设计

启动阶段按以下顺序执行：

1. `loadStartupConfig()` 校验密钥、路径、监听模式和端口；
2. `createApp()` 创建 Express 实例，不启动后台资源；
3. 创建 runtime resource registry；
4. 初始化数据库、迁移和 endpoint/tool registry；
5. 初始化 MCP；
6. 恢复 Memory 和 Wiki ingestion 持久化任务；
7. 启动 Memory worker、Wiki queue 和 Wiki lifecycle timer；
8. 监听 HTTP server；
9. 设置 `running`，返回 ready runtime。

启动资源注册采用“成功后立即登记”的方式。任一阶段失败时，runtime 从最后登记的资源开始调用关闭动作。

## 关闭设计

关闭阶段按以下顺序执行：

1. CAS 将状态从 `running` 改为 `stopping`；
2. 拒绝新 HTTP/SSE/AgentRun/后台任务；
3. 停止 Memory worker 和 Wiki queue 接受新任务；
4. 等待当前任务，使用共享 shutdown deadline；
5. 关闭或取消活跃 SSE/AgentRun；
6. 关闭 HTTP server；
7. 调用 `mcpService.shutdown()`；
8. 调用 `flushLangfuseTracing()`；
9. 清理 Wiki lifecycle timer；
10. 调用 `closeDb()`；
11. 状态设为 `stopped`。

每个资源关闭器必须：

- 可重复调用；
- 不向上抛出导致后续资源无法关闭的非致命错误；
- 记录成功、失败、超时；
- 使用同一个全局 deadline，防止逐资源超时叠加到不可控时长。

## 后台服务接入

### Memory

保留当前持久化 job 表和 claim 语义，新增生命周期控制：停止调度、等待正在执行的 extraction、超时后标记未完成状态。不得在 SQLite 关闭后继续 claim 或 complete。

### Wiki ingestion

保留 `JobQueue`/`JobStore` 结构，避免在本变更中替换队列。为 service 暴露显式 `start()`/`shutdown()` 或等价控制器，把构造函数中的 `queue.start()` 移入 runtime bootstrap。

### Wiki lifecycle

保存 `startWikiLifecycleProcessing()` 返回的 timer，runtime shutdown 时执行 `clearInterval()`。timer 已 `unref`，但不能因为不会阻止进程退出就省略显式清理。

### MCP / Langfuse / SQLite

MCP 使用现有 `shutdown()`；Langfuse 使用现有 `flushLangfuseTracing()`；SQLite 增加受控 close 入口，并保证所有数据库使用者已经停止。

### SSE / AgentRun

在入口层增加“停止接受新流”和“关闭活跃流”的协调点。现有 SSE event 格式不变；客户端断开仍由原有 close handler 处理。

## 入口设计

| 入口 | runtime 行为 |
| --- | --- |
| `server/index.ts` | 仅在直接执行入口中创建 `node` runtime；被 import 时只导出工厂/函数 |
| CLI `serve` | 显式创建 `cli` runtime，监听 SIGINT/SIGTERM，等待 shutdown 完成 |
| Docker | 显式创建 `docker` runtime，监听 `0.0.0.0`，响应 SIGTERM |
| Electron development | 使用外部 server，不启动内嵌 HTTP runtime |
| Electron production | 创建 `electron` runtime，IPC 与 HTTP 共用其资源，退出前等待 shutdown |

`AI_CHAT_CLIENT_DIST` 只表示静态客户端路径，不再承担“是否自动启动”的控制语义。

## 设计与验收映射

| 设计 | 验收 | 计划任务 |
| --- | --- | --- |
| DS-001 纯 App 组装与无 import 副作用 | AC-001 | TP-1 |
| DS-002 ServerRuntime 状态和资源 registry | AC-003、AC-004 | TP-2 |
| DS-003 后台 worker/queue/timer/外部资源关闭协议 | AC-005、AC-006 | TP-3 |
| DS-004 Node/CLI/Docker/Electron 入口适配 | AC-002、AC-007、AC-008 | TP-4 |
| DS-005 生命周期回归、Harness 和 smoke 验证 | AC-004、AC-008、AC-009 | TP-5 |

## 风险与发布验证

- 风险：模块单例被测试或 IPC 直接引用。措施：保留导出兼容层，先迁移入口再收紧内部可见性。
- 风险：Electron 主进程退出事件无法直接 await。措施：使用一次性退出 Promise 和退出锁，在清理完成后调用 `app.quit()`。
- 风险：HTTP `server.close()` 不会主动结束所有 SSE。措施：维护活跃连接集合或统一取消控制器，并添加活跃 SSE shutdown 测试。
- 风险：某个关闭器失败阻断后续清理。措施：runtime 逐项捕获、记录并继续，最终聚合 shutdown 结果。
- 风险：Node native module ABI 不一致。措施：按项目 Node 版本执行环境预检和 Electron artifact smoke。

发布前必须完成：typecheck、lint、unit、coverage、boundary、Harness verify、Docker smoke 和 Electron smoke。
