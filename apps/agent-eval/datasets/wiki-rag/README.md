# Wiki-RAG 评测集

这个目录保存 Mint 的问题级 Wiki/RAG 评测资产。`raw/` 是固定的原始源文档，不是用户生产 Wiki，也不应被运行中的 Mint 数据库直接复用。

## 内容

- `raw/`：10 篇源文档，覆盖 Markdown、HTML、TXT、PDF 和多个知识主题；这是源文档，不是已经摄入的页面。
- `../wiki-rag.json`：20 条问题级用例，其中 18 条要求基于来源回答，2 条要求无答案拒答。
- `manifest.json`：语料版本、文件格式和排除文件记录。
- `fixture/`：`prepare` 生成的确定性隔离 Wiki 页面，用于检索层验证。

问题用例支持以下断言：

- `mustContain` / `mustContainAny`：答案必须包含的事实或候选表达。
- `requiredSourceFiles`：回答必须引用的来源关键词。
- `minCitations`：最少引用数量。
- `mustAbstain` / `abstainMarkers`：知识库没有依据时必须明确拒答。
- `mustUseTools` / `maxToolCalls`：Agent 工具编排约束。

## 运行

先在 `apps/agent-eval/.env` 中填写 API 配置。也可以从仓库根目录直接使用 workspace 脚本：

```bash
npm run eval:prepare -w agent-eval
npm run eval:wiki-rag:dry -w agent-eval
```

先验证数据集结构和评测器逻辑，不需要 API Key：

```bash
node scripts/with-node-version.cjs tsx apps/agent-eval/src/cli.ts \
  run --dataset wiki-rag --dry-run \
  --output /tmp/mint-wiki-rag-dry-report.json
```

真实 Agent 评测需要先把这批源文档按 Mint 的摄入流程导入一个隔离 Wiki，并配置对应的 AI endpoint：

```bash
node scripts/with-node-version.cjs tsx apps/agent-eval/src/cli.ts \
  run --dataset wiki-rag --live \
  --runs 1 \
  --output apps/agent-eval/viewer/report.json
```

`--dry-run` 只检查用例、来源和拒答断言是否可执行，不代表模型质量通过。真实质量以 `--live` 结果中的 `passAt1`、`citationCoverageRate` 和 `abstentionAccuracy` 为准。

## 正式知识摄入

如果要评估“源文档 → Mint Wiki 摄入 → Agent 检索 → 回答与引用”的完整链路，使用 Mint 的正式摄入服务：

```bash
npm run eval:wiki-rag:ingest -w agent-eval
```

摄入完成后，使用同一个 Wiki 目录和评测数据库运行真实 Agent 评测：

```bash
npm run eval:wiki-rag:live -w agent-eval
```

`ingest` 会把 10 篇源文档逐篇交给 Mint 的 `ingestWikiSource`，并保留原始文件名，便于引用追溯。评测数据库和 Wiki 目录必须使用隔离路径；不要指向生产 Wiki 或生产数据库。
摄入输出目录必须是空目录，以避免旧页面污染本次评测；重复运行时请换一个临时目录。
