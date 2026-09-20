# 设计文档：Jev 实验性 Wiki Rerank

变更标识：`2026-09-19-jev-rerank-experimental`

## 目标与约束

在 `searchWiki` 中增加可替换的 rerank 决策边界，保持 FTS/向量召回及默认 legacy 行为。Jev 是 `state + questions -> answers`，独立于 `ApiAdapter`；所有高风险过滤与页面生命周期规则仍由代码控制。

## 最终决策

采用 provider + policy：

```text
searchWiki
  ├─ FTS/BM25 + vector recall
  ├─ createRerankProvider(jevSettings)
  │    ├─ JevRerankProvider（开启时）
  │    └─ LegacyRerankProvider（永远可用）
  ├─ rerank policy：Jev 成功采信，否则 legacy
  └─ page aggregation / lifecycle filter / source-family expansion
```

### DS-001：抽象接口

`RerankProvider` 接受 query、候选文档和候选的 lexical/vector rank，返回带排序分的候选列表或结构化 `unavailable`。provider 不执行页面过滤、不修改候选内容、不决定最终结果数量。

### DS-002：Legacy provider

Legacy provider 搬移当前 `rrfScore` 及 RRF 初排语义：关键词权重 0.6、向量权重 0.4、RRF 常数 60。页面聚合使用 provider 的排序分和既有 evidence boost；结果转换继续保留 title、heading、tag、claim、lifecycle boost。

### DS-003：Jev provider

Jev 先按 legacy base score 取得稳定的前置候选，再只对前 `JEV_RERANK_TOP_K` 个候选执行 Noul：

```text
state = { query, candidate }
question = "Does this candidate directly answer the query?"
```

候选必须由代码提供；每个候选返回一个 0~1 的 `noul`，按该值降序排列。未进入 Jev Top-K 的候选保留 legacy 顺序并排在已评分候选之后。Jev 结果只作为实验排序分，不覆盖 lexical/vector rank。

### DS-004：回退策略

policy 只在 Jev provider 返回完整成功结果时采信；以下情况整次回退 legacy：未开启、未配置、任意候选调用失败、关键答案缺失、响应结构异常、超时、429/529 重试耗尽或网络错误。不得将部分 Jev 结果与 legacy 结果混合成不可审计的排序。

### DS-005：配置边界

在既有实验性功能的 Jev 配置中新增 `jevRerankEnabled`，默认 `false`。复用 Jev Endpoint、API Key、Model 和 timeout；不新增数据库表或 migration。前端只展示独立开关，Top-K 为服务端实验常量，避免扩张配置面。

### DS-006：可观察性

记录 search mode、rerank provider、候选数、Jev 评分候选数、回退原因和总耗时；不记录 API Key，不改变 Wiki 返回协议。

## 影响与验证

主要影响文件为 `server/services/api/wikiSearchService.ts`、`server/services/rerank/`、Jev 设置类型/保存映射和实验性设置卡片。GitNexus 影响分析显示 `searchWiki` 风险 LOW；直接修改原 `rrfScore` 风险 HIGH，因此采用 provider 隔离。

纯后端链路的浏览器验收不适用；设置开关属于既有设置 UI 的小字段增量，本变更以前端组件单测和端点/设置集成测试验证，不创建浏览器场景。
