# Mint Agent Eval

Mint 的 Agent、Wiki/RAG、引用和无答案拒答评测工具。

## 快速开始

从仓库根目录执行：

```bash
cp agent-eval/.env.example agent-eval/.env
# 编辑 agent-eval/.env，填写 AI_CHAT_ENCRYPTION_KEY、MINT_EVAL_API_KEY 等配置

npm run eval:list -w agent-eval
npm run eval:prepare -w agent-eval
npm run eval:wiki-rag:dry -w agent-eval
```

也可以进入目录后执行：

```bash
cd agent-eval
npm run eval:wiki-rag:dry
```

`agent-eval/.env` 已被 Git 忽略；提交代码时只提交 `.env.example`，不要提交 API Key。

## 环境变量

| 变量                             | 用途                                                     | 是否必需               |
| -------------------------------- | -------------------------------------------------------- | ---------------------- |
| `AI_CHAT_ENCRYPTION_KEY`         | 隔离评测数据库加密设置                                   | `ingest` / `live` 必需 |
| `MINT_EVAL_API_URL`              | AI API 根地址，例如 `https://api.example.com`            | `ingest` 必需          |
| `MINT_EVAL_API_KEY`              | AI API Key                                               | `ingest` 必需          |
| `MINT_EVAL_MODEL_ID`             | 模型 ID                                                  | `ingest` 必需          |
| `MINT_EVAL_WIKI_SEARCH_MODE`     | Wiki 检索模式：`keyword` 或 `hybrid`，live 默认 `hybrid` | 可选                   |
| `MINT_EVAL_EMBEDDING_API_URL`    | OpenAI 兼容 Embedding API 根地址                         | hybrid 必需            |
| `MINT_EVAL_EMBEDDING_MODEL`      | Embedding 模型，默认 `bge-m3`                            | hybrid 必需            |
| `MINT_EVAL_EMBEDDING_DIMENSIONS` | 向量维度，当前必须为 `1024`                              | hybrid 必需            |
| `MINT_EVAL_FEATURES_FILE`        | 通用 Feature 配置文件，支持 `.json` / `.js` / `.mjs`     | 可选                   |
| `MINT_EVAL_FEATURES_JSON`        | 通用 Feature 配置 JSON（兼容方式）                       | 可选                   |
| `MINT_EVAL_JUDGE_API_URL`        | Judge 的 OpenAI 兼容 API 根地址                          | 使用 `--judge` 必需    |
| `MINT_EVAL_JUDGE_API_KEY`        | Judge API Key                                            | 使用 `--judge` 必需    |
| `MINT_EVAL_JUDGE_MODEL_ID`       | Judge 模型 ID                                            | 使用 `--judge` 必需    |
| `MINT_EVAL_RAW_DIR`              | 原始语料目录                                             | 可选                   |
| `MINT_EVAL_FIXTURE_PATH`         | `prepare` 输出目录                                       | 可选                   |
| `MINT_EVAL_WIKI_PATH`            | 正式摄入后的隔离 Wiki 目录                               | `live` 必需            |
| `MINT_EVAL_DB_PATH`              | 隔离评测 SQLite 数据库                                   | `live` 必需            |
| `EVAL_VIEWER_PORT`               | 报告查看器端口，默认 `4174`                              | 可选                   |

OpenAI 兼容适配器会自动补充 `/v1/chat/completions`，因此 `MINT_EVAL_API_URL` 通常不要再写 `/v1`。

Wiki hybrid 检索会额外调用 `${MINT_EVAL_EMBEDDING_API_URL}/embeddings`，并使用 FTS 关键词结果与向量结果做 RRF 融合。当前 Embedding 客户端不发送认证 Header，因此默认配置适用于本机 Ollama 等无认证服务；远程需要认证的服务暂不能直接用于该命令。`ingest` 完成后会强制校验向量覆盖率为 100%，向量化失败不会静默降级为关键词评测。

Judge 与被测 Agent 配置分离。`--judge` 未显式开启时，评测不会发起 Judge 网络请求；建议使用与被测 Agent 不同模型家族的 Judge，并定期通过人工金标校准。

评测能力建议通过 `agent-eval/features.json` 或 `agent-eval/config.js` 配置，不需要为每个新能力增加新的 CLI 参数。两个文件会自动探测，也可以通过 `MINT_EVAL_FEATURES_FILE` 或 `--features-file` 指定其他路径。

`features.json` 示例：

```json
{
  "features": {
    "jev": {
      "enabled": true,
      "options": {
        "apiUrl": "https://api.typesafe.ai/v1/systemone",
        "apiKey": "<JEV_API_KEY>",
        "model": "jev-latest",
        "routingEnabled": true,
        "memoryEnabled": true,
        "rerankEnabled": true
      }
    }
  }
}
```

`config.js` 示例：

```js
export default {
  features: {
    jev: {
      enabled: true,
      options: {
        apiUrl: 'https://api.typesafe.ai/v1/systemone',
        apiKey: process.env.JEV_API_KEY,
        model: 'jev-latest',
        routingEnabled: true,
        memoryEnabled: true,
        rerankEnabled: true,
      },
    },
  },
};
```

也可以继续使用环境变量 JSON：

```bash
export MINT_EVAL_FEATURES_JSON='{"features":{"jev":{"enabled":true,"options":{"apiUrl":"https://api.typesafe.ai/v1/systemone","apiKey":"<JEV_API_KEY>","model":"jev-latest","routingEnabled":true,"memoryEnabled":true,"rerankEnabled":true}}}}'
```

也可以直接传入 `--features-json`。配置优先级为：`--features-json`、`MINT_EVAL_FEATURES_JSON`、`--features-file`、`MINT_EVAL_FEATURES_FILE`、自动发现的 `features.json` / `config.js`。`agent-eval` 会为当前运行创建独立的 RuntimeContext；未知 Feature 会被保留，不会要求修改评测主流程。路由结果和记忆门控结果会写入该次执行的 `state`，Wiki rerank 会通过同一 context 生效。

## 命令

### 查看数据集

```bash
npm run eval:list -w agent-eval
```

当前包括 `smoke` 和 `wiki-rag`。

### 准备确定性 Wiki fixture

```bash
npm run eval:prepare -w agent-eval
```

将 `datasets/wiki-rag/raw/` 下的 10 篇源文档转换为隔离 Wiki 页面，覆盖 Markdown、HTML、TXT 和 PDF。该命令不调用 AI，适合验证检索层。

### Dry-run

```bash
npm run eval:wiki-rag:dry -w agent-eval
```

Dry-run 使用确定性模拟执行器，只验证评测集结构、工具断言、引用断言和拒答断言，不代表真实模型质量。

### 正式知识摄入

先在 `.env` 中配置 API，然后执行：

```bash
npm run eval:wiki-rag:ingest -w agent-eval
```

该命令默认先清空隔离 Wiki 输出目录，再把 10 篇源文档逐篇交给 Mint 正式的 `ingestWikiSource` 流程，生成原始资料、结构化 Wiki 页面、搜索索引和隔离评测数据库。清理只作用于 `MINT_EVAL_WIKI_PATH` 或 `--output` 指定的目录，不会清理数据库。

直接调用 CLI 时，只有显式传入 `--clean` 才会清空输出目录：

```bash
node scripts/with-node-version.cjs tsx agent-eval/src/cli.ts \
  ingest --clean \
  --output /tmp/mint-wiki-rag-ingested \
  --db /tmp/mint-wiki-rag-agent-eval.db
```

不带 `--clean` 时仍会要求输出目录为空，避免误用已有 Wiki 数据。

### Live Agent 评测

摄入成功后，使用同一组 Wiki 和 DB：

```bash
npm run eval:wiki-rag:live -w agent-eval
```

`eval:wiki-rag` 是同一命令的简写：

```bash
npm run eval:wiki-rag -w agent-eval
```

如果已有完整评测 checkpoint，只对已保存的 Agent 结果运行 Judge，不重新调用 Agent：

```bash
npm run eval:judge-only -w agent-eval -- \
  --dataset wiki-rag \
  --resume viewer/runs/<run-id> \
  --runs 3
```

结果默认写入 `agent-eval/viewer/judge-report.json`，并保存为独立结果版本。旧 checkpoint 若未保存完整轨迹，会使用持久化的确定性指标重建最小 Judge 输入。

每次运行都会自动保存一个不可覆盖的结果版本；版本 ID 默认按“数据集-时间-随机后缀”生成。需要人工指定稳定名称时，可以传 `--version`：

```bash
npm run eval:wiki-rag:dry -w agent-eval -- \
  --version prompt-v1 \
  --version-dir /tmp/mint-agent-eval-versions

npm run eval:versions:list -w agent-eval -- \
  --version-dir /tmp/mint-agent-eval-versions

npm run eval:versions:repair -w agent-eval -- \
  --version-dir /tmp/mint-agent-eval-versions

npm run eval:versions:compare -w agent-eval -- \
  --baseline prompt-v1 --current prompt-v2 \
  --version-dir /tmp/mint-agent-eval-versions \
  --output /tmp/mint-agent-eval-comparison.json
```

`--version` 只用于自定义版本名，保存完整报告并拒绝覆盖已有 ID；不传时仍会自动保存。默认版本库为 `agent-eval/viewer/versions/`，可用 `--version-dir` 隔离 CI 或临时评测。`versions:list` 输出版本摘要，`versions:compare` 输出与现有 `--baseline <报告路径>` 相同的指标差值。启动 `npm run viewer -w agent-eval` 后，报告页会自动发现 `versions/index.json`，可以在页面上切换当前版本、选择基线并查看对比。

评测会在默认 `agent-eval/viewer/runs/<run-id>/checkpoint.json` 中原子保存每个已完成 run。长任务中断后可使用 `--resume <run-id 或检查点目录>` 继续，已完成的 run 不会再次调用 Agent/Judge；也可以用 `--run-dir`、`--runs-dir` 指定检查点位置。启动评测前会预检并规范化版本索引；如果最终索引写入失败，已生成的报告会保留在主输出或 `versions/recovery/`，不会被删除。`versions:repair` 可手动重建索引。

报告默认写入 `agent-eval/viewer/report.json`，包含：

- `passAt1`：单次通过率
- `queryPassAt1`：答案内容、最终展示引用和检索证据均通过率，不把工具预算超限单独混入查询质量
- `answerPassAt1`：答案内容与拒答行为通过率
- `toolBudgetPassRate`：工具调用次数和循环控制通过率
- `wikiSearchBudgetPassRate`：Wiki 查询是否控制在每题最多 2 次搜索（可用 `maxWikiSearchCalls` 覆盖）；评测模式每轮最多执行一次 Wiki 搜索
- `averageWikiSearchCalls`：每次评测平均 `wiki_search` 调用次数
- `unrelatedToolRate`：非 `wiki_search` 工具调用占比，用于识别 `discover_tools`、`invoke_skill` 等无关调用
- `passAtK` / `passPowerK`：默认以 `k=min(3, runsPerCase)` 计算；前者表示多次尝试至少一次通过，后者表示连续多次运行全部通过
- `caseStats`：每条用例的通过次数、通过率、延迟均值、标准差和 p95
- `comparison`：传入 `--baseline` 后生成的同名指标差值和版本警告
- `p50LatencyMs` / `p95LatencyMs`：端到端延迟分位数
- `essentialPassRate` / `importantPassRate` / `optionalPassRate`：分层 Rubric 通过率；Veto 中描述的是禁止出现的条件，命中后会直接否决用例
- `citationCoverageRate`：引用断言覆盖率
- `citationAccuracyRate`：来源引用准确率
- `citationGroundingRate`：最终答案引用能在本次检索证据中找到对应身份的比例
- `retrievalCoverageRate`：工具检索结果对目标来源断言的覆盖率；它与最终答案展示的引用覆盖率分开统计
- `abstentionAccuracy`：无答案拒答准确率
- `answerGatePassAt1` / `evidenceGatePassAt1`：答案 Gate / 证据 Gate 的最终通过率；答案 Gate 会区分硬条件和关键词等弱信号
- `qualityPassAt1`：答案 Gate 与证据 Gate 同时通过率

多次运行并与历史报告比较：

```bash
node scripts/with-node-version.cjs tsx agent-eval/src/cli.ts \
  run --dataset wiki-rag --live --runs 3 \
  --baseline /tmp/wiki-rag-baseline.json \
  --output /tmp/wiki-rag-current.json
```

用例还可以声明 `complexity`、`capabilities`、`expected.rubric` 和 `expected.finalState`。执行器可额外返回 `state`、token 用量、TTFT 和 `traceId`，以便把最终状态、成本和完整 Trace 纳入评测报告。

### 查看报告

```bash
npm run viewer -w agent-eval
```

浏览器打开 <http://localhost:4174>。也可以通过 `EVAL_VIEWER_PORT=8080` 修改端口。

### 测试与构建

```bash
npm test -w agent-eval
npm run build -w agent-eval
```

## 自定义路径和参数

CLI 支持覆盖环境变量：

```bash
node scripts/with-node-version.cjs tsx agent-eval/src/cli.ts \
  prepare --raw /path/to/raw --output /tmp/mint-wiki-rag-fixture

node scripts/with-node-version.cjs tsx agent-eval/src/cli.ts \
  run --dataset wiki-rag --dry-run \
  --output /tmp/mint-wiki-rag-report.json
```

正式评测的隔离参数示例：

```bash
node scripts/with-node-version.cjs tsx agent-eval/src/cli.ts \
  ingest \
  --output /tmp/mint-wiki-rag-ingested \
  --db /tmp/mint-wiki-rag-agent-eval.db \
  --api-url https://api.example.com \
  --api-key "$MINT_EVAL_API_KEY" \
  --model "$MINT_EVAL_MODEL_ID" \
  --wiki-search-mode hybrid \
  --embedding-api-url "$MINT_EVAL_EMBEDDING_API_URL" \
  --embedding-model "$MINT_EVAL_EMBEDDING_MODEL" \
  --embedding-dimensions "$MINT_EVAL_EMBEDDING_DIMENSIONS"

node scripts/with-node-version.cjs tsx agent-eval/src/cli.ts \
  run --dataset wiki-rag --live --runs 3 \
  --wiki /tmp/mint-wiki-rag-ingested \
  --db /tmp/mint-wiki-rag-agent-eval.db \
  --wiki-search-mode hybrid \
  --embedding-api-url "$MINT_EVAL_EMBEDDING_API_URL" \
  --embedding-model "$MINT_EVAL_EMBEDDING_MODEL" \
  --embedding-dimensions "$MINT_EVAL_EMBEDDING_DIMENSIONS"
```

Live 评测支持两种运行规模：`--runs 1` 用于快速验证，`--runs 3` 用于计算 Pass@3 和 Pass^3；未指定时默认运行 3 次。其他运行次数会被 CLI 拒绝。

运行时默认输出 `[eval] 当前/总数 start|judge|done` 进度行，包含用例 ID、轮次、通过状态和耗时，但不输出回答、提示词或密钥。需要仅保留最终 JSON 汇总时传入 `--quiet`。

## LLM-as-a-Judge

确定性验证仍负责工具预算、审批边界、引用身份、检索覆盖和最终状态。答案关键词只作为可审计的弱信号；当安全、状态、工具预算和证据结构硬条件满足时，即使关键词信号失败也会进入 LLM Judge。Judge 依据用例的 `expected.judgeRubric` 分别评估答案 Gate 与证据 Gate；Judge 高分不会覆盖安全、审批、引用身份或检索覆盖失败。

`judgeRubric` 包含 Essential / Important / Optional / Veto 维度。非 Veto 维度使用 1–4 分的可观察标准；Veto 使用 pass/fail。每个维度可声明 `gate: answer | evidence | both`，旧 Rubric 未声明时按维度 ID 兼容映射。Judge 结果必须返回每个维度的证据 ID、理由、置信度和简短结论。为避免长度偏差，Rubric 可设置 `maxAnswerChars`，报告会记录答案字符数。

### 上传评测分数到 Langfuse

可以将已生成的本地报告上传为 Langfuse Scores。上传内容仅包含 Viewer 中的整体汇总指标、Judge 汇总分数和数据集元数据，不上传逐用例分数、答案、提示词或 Wiki 正文：

```bash
npm run eval:langfuse:upload -w agent-eval -- \
  --report agent-eval/viewer/versions/<result-version>.json
```

也可以按版本 ID 逐条上传，默认从 `agent-eval/viewer/versions/` 读取：

```bash
npm run eval:langfuse:upload -w agent-eval -- \
  --version <result-version>
```

命令使用 `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY`，也可以通过 `--langfuse-base-url`、`--langfuse-public-key` 和 `--langfuse-secret-key` 传入。由于 Langfuse Scores API 要求关联对象，没有 Trace 的本地报告会通过稳定的 `sessionId` 归入同一评测会话。
上传使用 Langfuse Public Ingestion API 的 `score-create` 事件，事件 `timestamp` 使用报告的 `generatedAt`，因此历史版本会按评测生成时间展示，而不是按实际上传时间展示。

运行真实 Judge：

```bash
npm run eval:wiki-rag:judge -w agent-eval

# 或使用临时配置，不写入 .env
node scripts/with-node-version.cjs tsx agent-eval/src/cli.ts \
  run --dataset wiki-rag --live --judge \
  --judge-api-url https://api.example.com \
  --judge-api-key "$MINT_EVAL_JUDGE_API_KEY" \
  --judge-model "$MINT_EVAL_JUDGE_MODEL_ID"
```

报告额外给出 `judgePassAt1`、`averageJudgeScore`、`averageJudgeConfidence`、`judgeCriticalFailureRate` 和 `averageAnswerChars`。它们与确定性通过率并列，不压缩为单一总分。

### 人工校准

先从已生成的 Judge 报告导出模板，由人工填写 `passed` 和每个维度的 `score` / `passed`，再计算一致性：

```bash
npm run eval:calibration:export -w agent-eval -- --report /tmp/judged-report.json --output /tmp/judge-labels.json
# 编辑 /tmp/judge-labels.json 后：
npm run eval:calibration:compare -w agent-eval -- --report /tmp/judged-report.json --labels /tmp/judge-labels.json
```

比较结果包含总体通过一致率、答案 Gate 一致率、证据 Gate 一致率、维度精确一致率、平均绝对误差、样本是否充足和 `calibrated` 结论。P0 默认要求至少 20 条同题同轮人工标注，且总体/答案 Gate/证据 Gate/维度一致率均达到 80%；可用 `--require-calibrated` 让校准不足的命令以非零状态退出。建议继续积累 100–200 条覆盖成功、失败、边界和对抗样本的人工金标；Judge 模型或 Rubric 改动后重新校准。

```bash
npm run eval:calibration:compare -w agent-eval -- \
  --report /tmp/judged-report.json \
  --labels /tmp/judge-labels.json \
  --require-calibrated
```

### A/B 配对评审与 Elo

对两份相同数据集报告做模型或编排选型时，使用交换顺序的配对 Judge。若 A/B 在确定性硬门禁上结果不同，门禁结果直接判胜；否则 Judge 会将 A 在前和 B 在前分别评估，只有两次映射回原顺序后结论一致才计胜，分歧保守记为平局。

```bash
npm run eval:pairwise -w agent-eval -- \
  --dataset wiki-rag \
  --report-a /tmp/model-a.json --label-a model-a \
  --report-b /tmp/model-b.json --label-b model-b \
  --output /tmp/model-a-vs-b.json

npm run eval:pairwise:elo -w agent-eval -- --input /tmp/model-a-vs-b.json
```

配对报告会输出胜负、平局和 `positionDisagreements`；Elo 仅表示此评测集上的相对能力，不能替代绝对 Rubric 分数或统计显著性分析。

## 数据集说明

Wiki/RAG 数据集位于 [datasets/wiki-rag](./datasets/wiki-rag/)，包括：

- `raw/`：10 篇原始源文档，已排除简历；
- `fixture/`：`prepare` 生成的确定性检索 fixture；
- `manifest.json`：语料版本、格式及排除文件记录；
- `../wiki-rag.json`：23 条问题级用例，包含可回答、无答案、多跳检索、边界拒答和审批安全问题。

`raw/` 是源文档，不等同于已经摄入的知识库页面。需要评估完整的“源文档 → 摄入 → 检索 → 回答”链路时，必须执行 `eval:wiki-rag:ingest`，并始终使用隔离 Wiki 和隔离 DB。
