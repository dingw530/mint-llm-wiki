# docs/changes 变更角色把控评估

## 判定口径

- 🟢：产品规格、交互规则和体验验收可由 PM 独立拍板；不代表 PM 可以独立批准代码上线。
- 🔴：需求阶段即需要开发共同把控，或变更本身是工程、安全、数据和运行时治理。
- 无论标签为何，上线前都必须由开发完成实现、测试、构建和发布验证。

| 变更 | Spec 对应功能点 | 仅 PM 把控 | PM 可以把控的点 | 仅开发能把控的点及原因 |
|---|---|---|---|---|
| `2026-04-30-markdown-rendering` | 将 AI 回复中的标题、列表、表格、代码块、链接等 Markdown 正确呈现在聊天页 | 🟢 | 支持语法；代码块复制/折叠；链接样式；异常内容提示 | XSS、流式半截内容渲染和长文本性能；涉及解析器、浏览器安全模型与运行时行为，不能仅凭产品体验判断。 |
| `2026-04-30-ux-enhancement` | 优化聊天布局、按钮、空状态、错误提示和操作路径 | 🟢 | 信息层级、操作步骤、文案、视觉验收 | 组件状态、响应式兼容、设计 token 与回归；取决于代码依赖和浏览器运行结果。 |
| `2026-07-19-tool-call-summaries` | 在回答中展示检索、读 Wiki、调用工具等执行摘要 | 🟢 | 摘要粒度、默认折叠、状态文案 | 服务端事件到 SSE/前端的映射、敏感参数脱敏、断流收敛；PM 无法判断事件真实性或泄密风险。 |
| `2026-07-21-chat-wiki-links` | 在回答中提供可点击、可定位的 Wiki 来源链接 | 🟢 | 链接文案、位置、预览和点击体验 | URI/文件路径解析、失效资源、路径穿越防护和跨端兼容；涉及文件系统安全边界。 |
| `2026-07-27-agent-status-bar` | 显示 Agent 思考、检索、调用工具、回答等实时状态 | 🟢 | 可见状态、名称、顺序、位置和消失时机 | 真实运行状态来源、多轮事件、取消/失败/SSE 乱序收敛；PM 无法验证状态数据是否真实。 |
| `2026-08-12-conversation-history-groups` | 按今天、昨天、近 7 天、更早分组历史对话 | 🟢 | 分组名称、时间范围、排序、空组规则 | 时区、跨日边界、分页和查询性能；需要数据库及时间戳正确性验证。 |
| `2026-07-24-retire-weather-feature` | 移除天气 Agent、工具入口和产品说明 | 🟢 | 下线决策、入口/文案移除、迁移说明 | 工具注册、提示词、API、测试残留和历史兼容；只删 UI 会留下后端入口或死链。 |
| `2026-07-25-github-pages-site` | 建设 Mint 中英文产品介绍站 | 🟢 | 信息架构、双语内容、品牌表达和转化目标 | 静态构建、部署、SEO、资源加载和死链；需要实际构建与线上验证。 |
| `2026-04-27-ai-chat` | AI 流式聊天、会话保存和消息展示 | 🔴 | 用户场景、交互、失败反馈 | SSE、模型 API、会话存储、断线和取消恢复；涉及并发与数据可靠性。 |
| `2026-04-28-system-prompt-thinking-mode` | 配置系统提示词和思考模式 | 🔴 | 开关、默认模式、用户说明 | Prompt 注入、模型兼容、Token 成本和隐私；必须以实现与运行数据验证。 |
| `2026-04-28-weather-agent-tool` | 通过 Agent 调用天气查询工具 | 🔴 | 使用场景、展示结果 | 外部 API、密钥、工具失败与限流；需要真实服务集成和安全处理。 |
| `2026-05-02-mcp-agent` | 接入 MCP Server 和自定义 Agent 工具 | 🔴 | 用户任务、工具可见性 | 协议握手、进程、权限和信任边界；外部工具可能读写文件或联网。 |
| `2026-05-03-memory-mechanism` / `2026-07-23-memory-mechanism-optimization` / `2026-08-03-memory-p0-hardening` | 跨对话记忆、优化及安全一致性加固 | 🔴 | 记忆价值、用户控制、删除规则 | 数据隔离、召回、删除语义、故障关闭和审计；PM 不能保证不串用户或遗留隐私数据。 |
| `2026-05-05-intelligent-routing` | 自动选择模型、工具或执行路径 | 🔴 | 质量/速度/成本的业务优先级 | 路由、超时、降级、成本控制和可观测性；依赖真实 Provider 行为。 |
| `2026-05-10-docker-electron` / `2026-06-30-electron-server-bundle` | Docker 部署与 Electron 桌面包 | 🔴 | 支持平台和交付方式 | 镜像、原生模块 ABI、打包、端口和进程退出；只能用真实构建产物验证。 |
| `2026-05-17-react-reasoning-paradigm` / `2026-07-15-react-event-state-model` | ReAct 多轮编排及事件状态模型 | 🔴 | 用户可见过程和停止预期 | 循环限制、工具失败、取消、事件契约和状态收敛；是运行时状态机问题。 |
| `2026-05-23-multi-model-endpoints` | 配置和切换多个模型端点 | 🔴 | 选择方式、默认项、配置体验 | Provider 协议、密钥加密、连接测试和错误分类；需实际调用验证。 |
| `2026-05-30-image-model-support` / `2026-06-07-image-chat` | 图片模型接入和对话化图片任务 | 🔴 | 生图入口、编辑流程、结果体验 | 异步任务、文件存储、模型协议、内容安全和失败重试。 |
| `2026-06-18-llm-wiki` / `2026-06-19-wiki-file-parsing` / `2026-07-02-wiki-url-ingest` | 文件/URL 导入并形成可检索知识库 | 🔴 | 支持来源、用户流程、成功定义 | 文件解析、抓取、SSRF、切分、索引和恢复；需要处理不可信输入和数据正确性。 |
| `2026-07-03-knowledge-graph-mvp` / `2026-07-08-knowledge-graph-auto-edge` | 知识图谱展示及自动关系建边 | 🔴 | 节点/关系语义、交互与审核规则 | 语义抽取、去重、图布局和大图性能；需算法和真实数据评估。 |
| `2026-07-10-cross-batch-semantic-review` / `2026-07-10-wiki-ingest-quality` / `2026-07-10-wiki-schema-management` | 跨批审核、摄入质量和分类标准 | 🔴 | 审核准则、分类语义、可用质量标准 | 候选生成、去重、Schema 校验、索引正确性和迁移兼容。 |
| `2026-07-15-wiki-ingestion-job-unification` / `2026-07-21-knowledge-ingestion-async-jobs` / `2026-08-04-ingestion-task-center` / `2026-08-24-ingestion-retry-command-status` | 将摄入统一为后台任务，展示状态、重试和命令入口 | 🔴 | 卡片字段、筛选、状态文案、重试体验 | 作业状态机、并发、幂等、持久化和恢复；需防止重试重复写入。 |
| `2026-07-22-decision-trace` / `2026-07-22-chat-trajectory` / `2026-07-22-token-usage` | 记录 Agent 行动、聊天轨迹和 Token 消耗 | 🔴 | 展示哪些指标和轨迹 | 跨轮采集、准确累积、脱敏和事件关联；PM 无法判断数据完整性。 |
| `2026-07-23-context-engineering` / `2026-08-14-context-provider` / `2026-06-18-context-window` | 控制模型上下文内容、顺序和窗口 | 🔴 | 上下文优先级和体验目标 | Token 预算、消息拼装、隐私隔离和模型兼容；需要代码路径和模型行为知识。 |
| `2026-07-23-mcp-error-cause-logging` / `2026-07-22-mcp-url-transport` | MCP 错误诊断和 URL 传输 | 🔴 | 用户错误说明 | 协议、日志脱敏、错误分类和网络连接；需真实协议与安全处理。 |
| `2026-07-24-harness-feedback-loop` / `2026-07-24-client-quality-optimization` | 自动化验收闭环和客户端工程质量 | 🔴 | 质量目标 | 测试、构建、静态检查和浏览器验收；只有开发能建立并解释工程证据。 |
| `2026-07-24-knowledge-lifecycle` / `2026-08-04-ingestion-result-verification` / `2026-08-09-ingestion-evidence-gate` | 知识更新/失效/删除，以及摄入结果与证据验证 | 🔴 | 生命周期规则、成功定义和失败反馈 | 版本、索引同步、原子校验、真实可检索性和一致性。 |
| `2026-07-24-tool-runtime-security-discovery` / `2026-08-29-bash-sandbox-isolation` / `2026-09-06-http-fetch-ssrf-hardening` | 工具主动发现、Bash 隔离与 SSRF 防护 | 🔴 | 哪些工具/能力可开放 | 文件和网络权限、命令逃逸、DNS/IP/重定向校验；属于攻击面控制。 |
| `2026-07-26-wiki-search-foundation` / `2026-08-08-hybrid-vector-search` / `2026-08-08-knowledge-retrieval-loop` | Wiki 基础检索、混合检索和检索闭环 | 🔴 | 搜索体验、排序目标、引用展示 | Embedding、BM25、RRF、召回率、延迟和向量服务；必须使用评测和实测。 |
| `2026-07-27-agent-evaluation` / `2026-08-24-agent-evaluation-llm-judge` / `2026-08-25-agent-eval-gated-judge-calibration` / `2026-08-25-agent-eval-result-versions` / `2026-08-24-wiki-eval-case-recovery` | Agent/Wiki 评测、Judge、Gate、版本和 Case 恢复 | 🔴 | 质量维度、阈值和发布标准 | 评测隔离、统计、Judge 校准、版本追溯和结果可信性。 |
| `2026-07-28-inline-a2ui-answer-blocks` | 在 AI 回答内渲染受控 A2UI 组件 | 🔴 | 哪些回答用组件、呈现效果 | Schema 校验、受控组件、数据验证和安全渲染。 |
| `2026-07-30-java-spring-backend` / `2026-06-10-server-refactor` / `2026-06-11-in-process-architecture` / `2026-07-23-react-adapter-routing` | 服务端语言、进程或 Adapter 架构调整 | 🔴 | 无独立产品决策 | 模块边界、接口兼容、依赖与运行时迁移；属于架构与回归控制。 |
| `2026-08-03-context-artifact-lifecycle` / `2026-07-23-artifact-escape` | 上下文产物生命周期与边界控制 | 🔴 | 用户可见保留/清理规则 | 持久化、引用、回收、泄漏和一致性。 |
| `2026-08-05-mint-wiki-protocol` / `2026-08-24-wiki-citation-normalization` | Wiki 统一链接协议与引用归一化 | 🔴 | 链接与引用显示规则 | URI 规范、来源定位、兼容、安全和检索准确性。 |
| `2026-08-09-ingestion-source-transaction` / `2026-09-06-migration-fail-closed` | 摄入/数据库迁移失败时不留下半成品 | 🔴 | 用户侧失败提示 | SQLite 事务、回滚、启动阻断和恢复；数据完整性必须靠故障测试确认。 |
| `2026-08-20-agent-run-durable-recovery` / `2026-08-20-agent-run-event-contract` | Agent 崩溃恢复与统一事件契约 | 🔴 | 恢复提示和状态语义 | 持久化、幂等恢复、事件兼容和崩溃一致性。 |
| `2026-09-02-first-use-model-connection` | 首次启动时引导配置并测试模型连接 | 🔴 | 引导流程、文案和成功标准 | API Key 安全存储、连接诊断和错误安全；需要实际服务连通性验证。 |
| `2026-09-04-localhost-exposure-boundary` | 规定本机 HTTP 与 Docker 服务暴露边界 | 🔴 | 用户访问方式和安装说明 | 监听地址、端口、容器网络和攻击面；配置错误会暴露本地服务。 |
| `2026-09-08-external-service-resilience` / `2026-09-08-vector-service-connection-test` | 外部服务连接检测、超时、重试和降级 | 🔴 | 等待、失败、重试体验 | 熔断、退避、错误脱敏和真实 Embedding/Chroma 连通性；需实测服务故障。 |
| `2026-09-11-server-lifecycle-remediation` | 修复服务启动、关闭及资源释放 | 🔴 | 无独立产品决策 | SIGTERM、SSE 清理、worker drain 和端口释放；只能通过进程级测试验证。 |
| `2026-07-23-current-time-tool` / `2026-06-18-subagent-firstclass-tool` | 新增时间工具或将子 Agent 作为一等工具 | 🔴 | 工具用途和入口 | 工具注册、权限、超时、并发和错误处理；需真实调用链验证。 |
| `2026-08-10-chat-scroll-state-machine` | 管理流式聊天时自动滚动、用户手动滚动和新消息提示 | 🔴 | 滚动体验与提示规则 | DOM 时序、异步竞态、状态机和性能；必须由开发处理浏览器事件细节。 |
| `2026-06-26-wiki-lint-retro` | Wiki lint 规则复盘与质量治理 | 🔴 | 内容质量目标 | lint 实现、规则误报/漏报、批量修复与兼容性。 |

## 结论

🟢 项目中只有 8 类偏展示、交互或产品内容的变更可由 PM 独立决定产品规格：Markdown、通用 UX、工具摘要、Wiki 链接、Agent 状态栏、会话时间分组、天气功能下线、产品站。

其余变更均触及不可信输入、数据写入、外部服务、Agent 运行时、协议、打包部署、安全边界或质量度量，因此在需求阶段就需要开发共同把控。
