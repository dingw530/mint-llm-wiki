# 设计文档：Wiki 知识页增量合并

## 文档信息

| 属性     | 值                                 |
| -------- | ---------------------------------- |
| 变更标识 | 2026-10-16-wiki-knowledge-merge    |
| 状态     | 执行中                             |
| 关联规格 | [product-spec.md](product-spec.md) |

## 背景与目标

`compileSource` 已读取 Wiki 页面清单、做标题去重，并在同路径时调用 LLM 合并。当前标题去重会直接移除高相似新页，因此同名以外的语义身份没有统一判定与路径映射。

目标是在现有编译与文件存储边界内增加一个身份解析阶段：找候选、优先 Jev、必要时回退 LLM，输出候选规范路径或不合并；随后由现有页面合并机制对规范路径做增量更新。

## 约束

- Wiki 正文继续由 Markdown 文件保存，Source/Claim 生命周期仍由现有服务维护。
- `compileSource` 的外部调用和 `WikiCompileResult` 契约不变。
- Jev 继续使用独立的 `JevSettings`、`callJev` 和 TypeSafe 有类型的问题，不并入通用 `AiSettings`。
- 调用 `callJev` 不修改其公共请求/错误契约；LLM 身份判断复用现有 `ApiAdapter`。
- 候选召回必须有限，LLM/JeV 结果不能提供任意写盘路径。
- GitNexus 当前索引对 Wiki 编译符号报 CRITICAL 且含噪声；实现仅触及 Wiki compiler、Jev settings 和对应测试，并用源码调用链确认入口。

## 方案选择

### 方案 A：继续使用标题阈值去重

实现成本低，但会把相关名称误判为同一对象，并丢弃新页面内容。不能满足增量知识整合目标。

### 方案 B：仅用通用 LLM 做身份匹配

可以处理别名和跨语言名称，但每次都要生成再解析文本；不满足用户选择的 Jev 优先策略，也增加不必要的 LLM 依赖。

### 方案 C：共享结果契约的 Jev→LLM Resolver（采用）

Jev 开启且请求成功时执行有类型的匹配判断；未开启或调用不可用时才走 LLM。两种 provider 返回相同的 `match | different | uncertain` 结果与候选路径。只有高置信唯一 match 进入现有页面合并；不同/不确定结果保留新页。

采用原因：复用 Mint 现有 Jev 设置与 LLM Provider，符合用户确认的优先级，同时将匹配判断与页面写入策略解耦。

## 最终设计

### DS-001：有限候选召回与确定性匹配

扩展现有页面扫描结果，提供页面标题、文件路径、分类、tags 与 frontmatter aliases。新页面也可在 frontmatter 中携带 aliases。精确规范化标题或 alias 命中时确定性映射。其他候选对新页面的标题和每个 alias 分别计算 bigram Dice 相似度；每个查询独立按 0.75 阈值筛选并取 Top‑5，再按规范文件路径去重合并。候选数量不会按所有 query 全局截断，相似度不能直接决定合并。拒绝合并的页若生成路径已被占用，会用稳定标题哈希后缀分配新路径，不能落到错误候选页上。

输入页和候选页以短摘要为主，正文片段采用有界截断。候选不存在时不调用模型，直接保留新页。

### DS-006：按标题与 alias 分别召回候选

确定性精确匹配后，将新页面标题和去重后的 aliases 作为独立 query。每个 query 对已有页面标题及 aliases 计算最高 Dice 相似度，筛选 ≥ 0.75 的页面并取最多 5 个。随后按规范路径合并各 query 的结果，保留最高相似度用于稳定排序；同一候选即使由多个 query 命中也只传入一次。候选列表仍按单个新页面构造，再交给现有 Jev→LLM resolver；候选召回不拥有合并决策权。

### DS-007：`wiki_merge` 工具身份判定

工具只接收 `sourcePath`，从既有 Wiki 文件读取源页。使用 DS-006 的标题/alias recall，过滤自身路径，再调用同一个确定性精确匹配与 Jev→LLM resolver。工具不接受模型提供的任意目标路径；no-candidate/different/uncertain/unavailable 都以 no-op 结果返回。

### DS-008：目标写入、修订快照和删除顺序

成功判定后复用现有页面合并 helper，保持目标 title/path 和正文保留/fallback 规则。先将源页原始 Markdown 原样归档至 `sources/`，写入 merge manifest entry；再更新目标页、生命周期版本和 Claims、相关内部链接、manifest、图谱引用与搜索索引。所有修改文件先缓存可恢复副本，源页活动 Markdown 最后删除。提交失败时恢复文件快照并保留源页；删除后的历史正文由归档快照和 superseded 生命周期记录保留。

现有 Graph 以节点 label 识别知识对象，source_file 连接 Wiki 页面。合并时将源节点边重定向到目标节点并去重，然后删除源节点并基于改写后的链接重建 references。搜索索引全量重建会移除已删除 sourcePath 的 FTS/向量文档。Claims 从源页及目标页的活动 Claims 迁移为目标新版本的 Claims；旧版本 Claims 标记 superseded。

### DS-009：工具授权与重试

工具声明 `approvalMode: always`、`retrySafety: never` 和非并发安全；没有审批授权时，tool policy 在 execute 前拦截。执行中失败不自动重试，工具返回明确失败状态供用户决定是否重新调用。

### DS-002：统一解析结果与 fallback

新增 Wiki 身份解析端口与协调服务，核心结果为：

```ts
type WikiIdentityDecision =
  | { kind: 'match'; targetPath: string; provider: 'deterministic' | 'jev' | 'llm' }
  | { kind: 'different'; provider: 'jev' | 'llm' }
  | { kind: 'uncertain'; provider: 'jev' | 'llm'; reason: string };
```

Coordinator 顺序：确定性匹配 → Jev（仅独立开关开启）→ Jev 未开启/失败/响应无效时 LLM → 统一校验目标属于候选集。有效 Jev `uncertain` 是终态，不触发 LLM。LLM 失败、JSON 无效或返回越界路径时返回 uncertain，保留新页。

Jev provider 放在 `infrastructure/ai/jev/`，由 application composition 通过 `WikiIngestionRequest` 注入；Wiki domain 只依赖 provider 接口并负责优先级与结果策略。LLM provider 留在 Wiki domain，复用项目允许的 `ApiAdapter` 能力。

Jev 对每个有限候选使用 Score 三档：不同对象、相关但无法确认、同一对象；questions 并发批量发送。只当档位为同一对象、confidence ≥ 0.90 且唯一候选满足条件时返回 match。其它档位均不合并。

LLM 使用当前 active AI adapter，输出 JSON：`{"decision":"match","targetPath":"..."}`、`{"decision":"different"}` 或 `{"decision":"uncertain"}`。Provider 验证 JSON schema、候选路径、候选唯一性；不接受自由路径或额外内容。

### DS-003：Jev 设置开关

在现有 Jev 实验设置卡增加 `jevWikiIdentityEnabled` 子开关，默认关闭。沿用设置键值持久化、settings endpoint、Electron API 和已有 API Key 脱敏规则；不增加 migration 或 endpoint。关闭时直接使用 LLM resolver。

### DS-004：将匹配结果应用到页面合并

在编译阶段对保留页面执行身份解析。match 时把新页面的目标 path/title 改成候选规范 path/title，再调用现有 `mergePageIfExists`，使合并器读取真实已有文件。不同或不确定时使用原始新路径。

同一编译批次若多个输入页映射到同一目标，按目标路径聚合新增正文、tags 和 aliases 后只执行一次 LLM 页面合并与一次写盘，避免最后一个页面覆盖前一个结果。合并仍受现有 Markdown 校验和正文收缩阈值保护；provider 失败时用确定性的追加方式保留旧正文和新正文。

标题相似去重不再移除页面；身份 resolver 的 match 是唯一允许把新页映射到已有页的语义路径。不同或不确定结果遇到路径冲突时会使用稳定新路径。关系抽取结果仍按现有图构建规则处理。

### DS-005：可观察性与失败处理

仅记录 resolver provider、候选数、决定类型和 fallback reason，不记录 API Key 或完整正文。LLM/JeV 失败不会静默吞掉页面；编译结果在写盘前仍然有完整的新页内容。若目标页面无法完成合并，摄入按现有编译失败和 staged-file 回滚语义处理。

## 影响与风险

- 修改 Wiki compiler 身份去重与合并前映射；新增 Wiki identity resolver/providers 及单元测试。
- 修改 Jev settings 类型/服务/endpoint 映射、前端 form 与 Jev settings card，增加浏览器场景。
- 主要风险是中文 Jev 判断偏差和中心编译器的高调用面。默认关闭 Jev、保守 confidence、候选路径校验、低置信不合并，并测试上传与 Chat 两条 ingestion 入口。
- 不涉及 DB migration；原始资料、manifest 与 Claims 生命周期的数据结构不变。

## 发布验证

- Jev 开关默认关闭并保存回显。
- Jev 正常、关闭、未配置、超时、无效响应分别覆盖；回退仅发生在关闭或不可用路径。
- 高置信 match、different、uncertain、多个候选、无效目标路径、同目标批内聚合均验证。
- 校验已有正文、新证据、tags、canonical path、manifest 与 search index 最终一致。

## 验收证据矩阵

| AC     | 设计       | 实现位置                   | 验证方式              | 最低证据                     | 状态 |
| ------ | ---------- | -------------------------- | --------------------- | ---------------------------- | ---- |
| AC-001 | DS-001/004 | Wiki compiler/resolver     | integration           | integration                  | PASS |
| AC-002 | DS-002/004 | Jev provider/coordinator   | unit + integration    | unit + integration           | PASS |
| AC-003 | DS-002     | LLM provider/coordinator   | unit + integration    | unit + integration           | PASS |
| AC-004 | DS-002/005 | Jev fallback/coordinator   | unit + integration    | unit + integration           | PASS |
| AC-005 | DS-001/004 | Wiki compiler              | integration           | integration                  | PASS |
| AC-006 | DS-004     | Wiki compiler/page merge   | integration           | integration                  | PASS |
| AC-007 | DS-004/005 | Ingestion/lifecycle/search | integration           | integration                  | PASS |
| AC-008 | DS-003     | Settings UI/service        | browser + integration | unit + integration + browser | PASS |
| AC-009 | DS-006     | Wiki compiler candidate recall | compiler test | unit | PASS |
| AC-010 | DS-007/009 | WikiMergeTool/schema/catalog   | unit + integration | unit + integration | 待验证 |
| AC-011 | DS-007/008 | Wiki merge service             | integration | integration | 待验证 |
| AC-012 | DS-007     | resolver/provider              | integration | integration | 待验证 |
| AC-013 | DS-003/008 | compiler merge helper          | integration | integration | 待验证 |
| AC-014 | DS-008     | revision/lifecycle/claims      | integration | integration | 待验证 |
| AC-015 | DS-008     | links/manifest/graph/search    | integration | integration | 待验证 |
| AC-016 | DS-005/008 | merge rollback                 | integration | integration | 待验证 |
| AC-017 | DS-001/009 | tool executor approval         | integration | integration | 待验证 |

Harness claim aggregation and run artifacts are recorded in [verify-report.md](verify-report.md).
