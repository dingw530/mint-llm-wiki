# 上下文管理

本文说明 Mint 在每次 Agent 模型调用前如何控制对话历史、打包长期记忆，以及把大工具结果移出模型上下文。内容以当前实现为准。

## 请求路径

每轮模型调用前，`apps/server/agent-runtime/react-loop-core.ts` 调用 `prepareContext()`。上下文管理器估算消息 token，并返回供本轮模型调用使用的消息。

上下文由三部分组成：

- 当前对话历史；
- 通过作用域与检索策略选出的长期记忆；
- 工具返回值。小结果直接放入 tool message，大结果改为 context artifact。

长期记忆和对话摘要使用不同策略。记忆是按类别、作用域召回的用户事实；摘要是当前运行内较早对话轨迹的压缩表示。

## 对话预算与压缩

实现位于 `apps/server/agent-runtime/context-window.ts`。

| 设置         |         默认值 | 用途                           |
| ------------ | -------------: | ------------------------------ |
| 上下文预算   | 100,000 tokens | 一次模型调用可用的总上下文预算 |
| 输出预留     |   4,096 tokens | 为模型输出保留空间             |
| 输入预算     |  95,904 tokens | 传给历史消息的估算预算         |
| 压缩触发阈值 | 输入预算的 80% | 超过阈值后压缩较早对话         |

token 数由 Mint 的估算器计算，不等同于 provider 的 tokenizer 计量。实际模型输入还受 provider 限制和请求格式影响。

当消息估算值不超过阈值时，系统保留原消息。超过阈值时：

1. 保留 system 消息，并按 user 消息边界切分完整对话单元。assistant 调用和对应 tool 结果会留在同一单元。
2. 将较早单元交给当前模型适配器生成摘要。摘要提示要求保留决策、约束、修改文件、验证结果、失败路径、待办和文件标识符。
3. 摘要生成失败或返回空内容时，使用确定性摘要，不阻断本轮执行。
4. 将摘要与最新完整对话单元放回上下文。若仍超过预算，先缩短摘要，再对消息内容做最后的保护性截断。

因此，system 消息和最新对话优先保留。较早历史经摘要后不再以原消息形式完整传递。

## 大工具结果与 Artifact

实现位于 `apps/server/infrastructure/tools/tool-result-artifact.ts` 和 `read-artifact-tool.ts`。

- 序列化结果超过 12,000 bytes 时，Mint 将完整 JSON 写到本地 artifact 文件。
- tool message 中保留简短摘要、最多 2,000 字符的预览、路径、字节数和 SHA-256；`read_artifact` 可按 offset 分页读取。
- `read_artifact` 只允许读取 Mint artifact 根目录中的 JSON 文件。单次最多读取 30,000 字符，默认 12,000 字符。
- 根目录可由 `AI_CHAT_CONTEXT_ARTIFACT_DIR` 指定；否则使用数据库目录旁的 `context-artifacts`，再回退到 `~/.mint/context-artifacts`。

默认容量上限为 1 GiB。预计写入量达到 80% 时，系统会清理过期文件并尝试回收空间，目标降到 70%。清理时保留最近 2 小时内修改的文件；仍无法满足容量限制时，写入会失败并返回明确错误。

默认清理规则是闲置 24 小时或创建满 7 天。当前闲置时间按文件修改时间计算，读取 artifact 不会延长闲置期限。

## 长期记忆

记忆准备位于 `apps/server/domains/memory/`。系统先读取适用于当前作用域的核心记忆，再对当前问题执行本地全文检索；检索候选经过词项覆盖筛选和稳定排序后进入上下文。

- 默认记忆总预算为 2,000 tokens，核心记忆预算为 500 tokens。
- 实际总预算还受当前模型输入预算和剩余输入空间约束。
- 单次召回最多选择 8 条检索记忆；事实按完整条目打包，不会把一条记忆截成半句。
- query 长度会限制在 600 个字符内，规范化后的检索词最多 32 个。

记忆内容被包在明确标记中，并声明其为历史事实而非操作指令。用户当前要求始终优先于记忆。

## 实现边界

- 上下文管理控制当前一次模型调用的消息输入，不持久化完整工具消息。
- artifact 是本地文件型上下文存储，不是 AgentRun 事件日志，也不是长期知识库。
- 压缩和 token 估算是输入管理策略，不证明摘要无损或回答质量提升；质量需要通过固定评测集验证。

## 主要实现

- `apps/server/agent-runtime/context-window.ts`
- `apps/server/agent-runtime/react-loop-core.ts`
- `apps/server/domains/memory/memory-service.ts`
- `apps/server/domains/memory/memory-context-packing.ts`
- `apps/server/infrastructure/tools/tool-result-artifact.ts`
- `apps/server/infrastructure/tools/read-artifact-tool.ts`
