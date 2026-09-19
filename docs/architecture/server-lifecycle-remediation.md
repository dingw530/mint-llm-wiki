# Mint 启动与关闭生命周期整改方案

更新时间：2026-09-11
适用范围：Node HTTP、CLI、Docker、Electron 进程，以及 MCP、Memory、Wiki ingestion、Wiki lifecycle、SSE、Langfuse 和 SQLite 等由服务进程持有的资源。
关联技术债务：[TD-030](../technical-and-product-planning-debt.md#td-030)

## 1. 结论先行

当前 Mint 的启动逻辑分散在 `app.ts`、`index.ts`、CLI、Docker 入口和 Electron 主进程中。部分服务在模块导入阶段通过副作用启动，资源创建后也没有统一的所有权和关闭出口。

本整改的目标不是重写服务层，而是建立一个明确的生命周期边界：

```text
loadStartupConfig
        ↓
createApp
        ↓
createServerRuntime
        ↓
runtime.start()
        ↓
HTTP + SSE + MCP + Memory + Wiki Queue + Timers
        ↓
runtime.shutdown()
```

所有入口都显式创建并启动同一个 `ServerRuntime`；所有进程退出路径都调用幂等、有超时的 `shutdown()`。

## 2. 当前问题

### 2.1 模块导入会产生启动副作用

`server/app.ts` 在模块导入时注册 `setTimeout`，异步启动 MCP、Memory worker 和 Wiki lifecycle timer，见 [server/app.ts](../../server/app.ts)。

`server/index.ts` 又根据 `AI_CHAT_CLIENT_DIST` 是否存在决定是否自动启动 HTTP server，见 [server/index.ts](../../server/index.ts)。

这会导致：

- 测试、CLI 或其他模块仅仅 import 服务模块，就可能启动后台任务；
- “是否自动启动”依赖环境变量这一隐式约定；
- 启动失败和资源清理无法由调用方统一控制。

### 2.2 CLI 存在重复启动风险

CLI 的 `serve` 命令会 import `server/index.ts` 后再次调用 `startServer()`，见 [server/cli/index.ts](../../server/cli/index.ts)。在未设置 `AI_CHAT_CLIENT_DIST` 时，import 本身可能已触发一次自动启动，随后显式调用又会启动一次。

端口冲突时当前逻辑会尝试随机端口，这可能掩盖重复启动，而不是暴露入口管理错误。

### 2.3 HTTP server 的资源所有权不明确

当前 `startServer()` 只返回实际端口，不返回 `http.Server` 或关闭函数。调用方无法明确知道：

- 哪个对象负责关闭监听器；
- 哪些 SSE 连接仍然存活；
- 哪些后台资源属于本次启动实例；
- 启动失败后哪些资源已经创建。

### 2.4 后台资源由不同模块各自管理

当前至少存在以下几类生命周期模型：

| 资源 | 当前方式 | 主要问题 |
| --- | --- | --- |
| MCP | `mcpService.initialize()` / `shutdown()` | 有关闭能力，但未接入统一 runtime |
| Memory | 模块级 `scheduled` / `running` + `setImmediate` | 没有 stop、idle 和关闭超时接口 |
| Wiki ingestion | 构造函数直接 `queue.start()` | 导入即启动，queue 的关闭没有上升到入口 |
| Wiki lifecycle | `setInterval()` 并返回 timer | `app.ts` 丢弃 timer，无法统一清理 |
| SSE | 每条连接自行维护 heartbeat | 缺少进程级连接收敛和退出协调 |
| Langfuse | 提供 `flushLangfuseTracing()` | 有能力但没有统一调用点 |
| SQLite | `getDb()` 延迟创建 | 生产关闭阶段没有统一 `closeDb()` |

### 2.5 Electron 退出路径没有关闭服务 runtime

Electron 当前主要关闭窗口和 logger。生产模式下 server bundle 在主进程内运行，但 `will-quit` 没有等待 server、MCP、后台 worker、Langfuse 和 SQLite 完成关闭。

这会增加以下风险：

- MCP 子进程或连接残留；
- SQLite WAL 数据尚未完成落盘；
- 正在运行的 Agent/SSE 被直接截断；
- Electron 重启时旧资源尚未释放。

### 2.6 启动失败无法完整回滚

Electron 使用并行方式加载服务模块和启动 server。任一步骤失败后，当前主要通过弹窗和 `app.quit()` 退出，没有统一的部分成功资源回滚协议。

## 3. 目标设计

### 3.1 `createApp()` 只负责组装 Express

`createApp(options)` 只完成：

- middleware 注册；
- endpoint/router 注册；
- 静态文件配置；
- 错误处理器注册。

它不得：

- 启动 MCP；
- 启动 Memory worker；
- 启动 Wiki queue 或 timer；
- 监听 HTTP 端口；
- 注册进程信号处理器。

### 3.2 `ServerRuntime` 负责资源所有权

建议引入如下概念模型：

```ts
interface ServerRuntime {
  readonly state: 'created' | 'starting' | 'running' | 'stopping' | 'stopped';
  readonly port?: number;
  start(): Promise<void>;
  shutdown(reason?: string): Promise<void>;
}
```

runtime 至少持有：

- Node `http.Server`；
- Wiki lifecycle timer；
- Memory worker 控制器；
- Wiki ingestion queue；
- MCP service；
- SSE/AgentRun 活跃连接或取消控制器；
- Langfuse flush 入口；
- SQLite close 入口。

`start()` 和 `shutdown()` 都必须幂等。`shutdown()` 重复调用时返回同一个关闭 Promise，而不是重复关闭资源。

### 3.3 显式区分入口模式

建议使用显式配置，而不是使用 `AI_CHAT_CLIENT_DIST` 推断启动行为：

```ts
type RuntimeMode = 'node' | 'cli' | 'docker' | 'electron';
type ListenMode = 'loopback' | 'container' | 'external';
```

入口行为：

| 入口 | 行为 |
| --- | --- |
| Node | 创建 loopback runtime 并启动 HTTP |
| CLI `serve` | 创建一次 loopback runtime 并等待 shutdown |
| Docker | 创建 container runtime，监听 `0.0.0.0` |
| Electron development | 使用外部 HTTP server，不重复启动内嵌 server |
| Electron production | 在主进程内创建并持有 runtime，同时注册 IPC |

## 4. 启动流程

启动顺序建议固定为：

1. 读取并校验启动配置；
2. 创建 Express App；
3. 初始化数据库和迁移；
4. 初始化工具和 endpoint registry；
5. 初始化 MCP；
6. 恢复 Memory 持久化任务；
7. 恢复 Wiki ingestion 任务；
8. 启动 Memory worker；
9. 启动 Wiki ingestion queue；
10. 启动 Wiki lifecycle timer；
11. 启动 HTTP server；
12. 记录 ready 状态并返回 runtime。

规则：

- HTTP 监听成功前不得报告服务 ready；
- 可降级资源必须显式记录降级状态；
- 任一致命步骤失败时，按已完成步骤的逆序回滚；
- 启动函数不得直接 `process.exit()`，由最外层入口决定退出码。

## 5. 关闭流程

关闭顺序建议固定为：

1. 将 runtime 状态改为 `stopping`；
2. 停止接受新的 HTTP 请求、SSE 和 AgentRun；
3. 停止 Memory worker 和 Wiki ingestion queue 接收新任务；
4. 等待当前任务完成，设置最大等待时间；
5. 关闭或取消活跃 SSE/AgentRun；
6. 关闭 HTTP server；
7. 关闭 MCP 连接；
8. flush Langfuse；
9. 清理 Wiki lifecycle timer；
10. 关闭 SQLite；
11. 关闭 logger；
12. 将 runtime 状态改为 `stopped`。

必须满足：

- shutdown 幂等；
- 每个等待步骤有超时；
- SQLite 晚于所有后台 worker 关闭；
- shutdown 超时后记录未完成资源并继续有限度退出；
- 不使用 `process.exit()` 替代资源清理。

## 6. 分阶段执行计划

### TP-1：消除 import 副作用

范围：`server/app.ts`、`server/index.ts`、Wiki job service 初始化路径。

完成标准：

- import `app.ts` 不启动 timer、MCP、worker 或 HTTP；
- import `index.ts` 不自动监听端口；
- CLI `serve` 只调用一次启动函数；
- 现有 API 测试不依赖“导入即启动”。

### TP-2：建立 `ServerRuntime`

范围：HTTP server、启动状态和部分成功回滚。

完成标准：

- runtime 持有真实 `http.Server`；
- `start()`、`shutdown()` 幂等；
- 启动失败会清理已创建的资源；
- 不再用“返回端口”作为唯一运行状态。

### TP-3：接入后台服务关闭协议

范围：Memory、Wiki queue、Wiki lifecycle、MCP、Langfuse、SQLite。

完成标准：

- Memory 有停止接收、等待空闲和超时能力；
- Wiki queue 有公开 shutdown；
- Wiki timer 由 runtime 持有并清理；
- MCP shutdown、Langfuse flush 和 SQLite close 均有调用证据；
- 关闭过程中不会新领取任务或新建 SSE。

### TP-4：统一四类入口

范围：Node、CLI、Docker、Electron。

完成标准：

- 四类入口不再依赖隐式环境变量判断是否启动；
- Node/CLI 不双启动；
- Docker 仍监听容器地址；
- Electron development 不启动重复 server；
- Electron production 退出前等待 runtime shutdown。

### TP-5：生命周期回归与真实运行验收

范围：自动化测试、Electron smoke、Docker smoke。

完成标准：

- 覆盖 SIGINT、SIGTERM、Electron `before-quit`；
- 覆盖启动中途失败、端口冲突、SSE 活跃、队列有任务、MCP 已连接等场景；
- Electron 打包产物完成启动—退出 smoke；
- Docker 完成启动—请求—SIGTERM—退出 smoke；
- 无残留端口、MCP 连接、SQLite 锁和未清理 timer。

## 7. 风险与边界

### 7.1 不在本次整改范围内

- 不重写 repository/service 分层；
- 不更换 SQLite、队列或 MCP 实现；
- 不把 Electron 改造成独立 server 子进程；
- 不同时重构 AgentRun 业务状态模型；
- 不将所有异步任务立即合并成一个通用队列。

### 7.2 需要重点防止的回归

- Electron IPC 依赖 server bundle 导出的服务对象；
- Docker 必须保持 `0.0.0.0` 容器监听语义；
- Node/Electron 默认仍应保持 loopback 安全边界；
- 测试环境不能因 import app 而创建真实后台任务；
- 数据库迁移失败仍必须保持 fail-closed。

## 8. 验收证据

实施完成后应至少保留以下证据：

| 证据 | 说明 |
| --- | --- |
| 单元测试 | runtime 状态、幂等 shutdown、启动失败回滚 |
| 服务测试 | Memory、Wiki queue、MCP、Langfuse、SQLite 关闭顺序 |
| 入口测试 | Node、CLI、Docker、Electron 各只启动一次 |
| 信号测试 | SIGINT/SIGTERM 和 Electron before-quit |
| SSE 测试 | 活跃连接关闭、新连接拒绝、heartbeat 清理 |
| Docker smoke | 容器启动、API 请求、SIGTERM、退出码和端口释放 |
| Electron smoke | 打包应用启动、IPC 调用、退出和资源释放 |

在上述证据全部具备前，TD-030 状态只能标记为“进行中”或“待验证”，不能标记为“已完成”。
