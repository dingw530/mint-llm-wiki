# 产品规格：Jev 实验性 Wiki Rerank

变更标识：`2026-09-19-jev-rerank-experimental`

## 背景与目标

Mint 当前 Wiki 检索使用 FTS/BM25 与向量召回，再通过 RRF 和规则分完成排序；该链路没有独立的语义 rerank。目标是在不改变默认行为的前提下，增加 Jev 语义 rerank 实验，并允许按实验性功能单独启用。

## 范围

包含：

- 为 Wiki rerank 暴露抽象 provider 接口。
- 将现有 RRF/规则排序封装为 legacy provider。
- 增加 Jev provider，对有限 Top-K 候选执行语义相关性判断。
- 增加独立的 `jevRerankEnabled` 实验开关，默认关闭。
- Jev 未配置、超时、限流、响应异常或调用失败时回退 legacy provider。
- 保留现有 chunk、页面聚合、生命周期过滤、source-family 扩展和结果字段语义。

不包含：

- 不替换 FTS、embedding、VectorStore 或 RRF 召回链路。
- 不让 Jev 生成答案、生成工具参数或决定权限。
- 不新增数据库迁移。
- 不要求本次完成真实 TypeSafe 线上质量提升证明；线上效果需另行评测。

## 业务规则

- BR-001：`jevRerankEnabled=false` 时，结果顺序和 legacy 排序行为保持兼容。
- BR-002：Jev 只处理代码已召回的有限候选，不从全量 Wiki 自由选择内容。
- BR-003：Jev rerank 只在配置开关、API Key、Endpoint 均可用时尝试。
- BR-004：Jev 任一候选调用失败、响应缺失关键答案或整体超时，整次 rerank 回退 legacy，不能返回部分 Jev 排序结果。
- BR-005：Rerank provider 不得绕过页面状态过滤、路径安全、引用粒度和现有结果上限。
- BR-006：Jev rerank 的配置与路由、记忆开关独立保存；默认关闭。

## 验收标准

- AC-001：代码存在抽象 `RerankProvider`，legacy 与 Jev 均通过该接口提供排序结果。
- AC-002：实验开关关闭或 Jev 不可用时，Wiki 搜索使用 legacy provider，既有 Wiki 单测和 hybrid 单测继续通过。
- AC-003：实验开关开启时，Jev 对配置数量的候选逐项执行相关性判断，并按 Jev 结果重新排序。
- AC-004：Jev 响应 malformed、网络失败、超时、限流或缺少答案时，整次请求回退 legacy，Wiki 搜索仍返回结果。
- AC-005：设置页面实验性功能中显示并保存独立 rerank 开关，首次默认关闭；保存后能正确回显。
- AC-006：rerank provider 的候选数量、调用失败和最终 provider 可通过结构化日志观察；不泄露 API Key。
- AC-007：不新增数据库 migration，且服务端架构边界、类型检查、格式检查和 git diff check 通过。

## 风险与依赖

| 风险                                | 缓解                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| Jev 中文语义质量未知                | 默认关闭；整次失败回退 legacy；保留 provider 观测数据            |
| 每个候选一次 Jev 请求导致延迟或限流 | 只处理有限 Top-K，并行调用；使用现有 Jev 超时与重试预算          |
| 结果字段被语义分数改变              | provider 输出独立排序分，保留 lexical/vector rank 与现有证据字段 |
| 实验逻辑影响默认链路                | legacy provider 复用现有公式，关闭态不调用 Jev                   |
