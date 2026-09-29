# 执行计划：Wiki 摄入提交崩溃恢复

当前 TP：TP-004

## 完成定义

- 异步摄入在编译快照后发生进程退出，可由新 worker 从 SQLite 快照恢复，不重复调用 LLM。
- Source、页面、生命周期、索引和 manifest 副作用可安全重放。
- 上传和 Chat 多项作业保持兼容及隔离。
- 真实子进程退出/恢复证据、Harness claim 聚合、server typecheck/build、相关格式检查均通过。

## 范围与保护路径

允许路径：

- `docs/changes/2026-09-23-wiki-ingestion-crash-recovery/`
- `docs/product-specs/README.md`
- `docs/design-docs/README.md`
- `docs/exec-plans/README.md`
- `server/migrations/`
- `server/repositories/`
- `server/services/api/`
- `server/services/jobs/`
- `server/services/utils/wikiCompiler.ts`
- `server/services/utils/wikiShared.ts`
- `server/services/api/__tests__/`
- `server/services/jobs/adapters/__tests__/`
- `server/migrations/__tests__/`
- `server/scripts/`
- `scripts/`

保护路径：

- `.harness/`
- `.claude/skills/`
- `client/`
- `electron/`
- `agent-eval/`
- 工作区既有改动 `client/src/styles/sidebar.css`、`client/src/styles/wiki.css`

## 前置条件与影响分析

- GitNexus repository：`mint-ai-chat`，路径 `/Users/wangding/WorkSpace/personal/ai-chat`，索引 commit `4268948`，索引时间 2026-09-23 19:18。
- 影响结果：`compileSource` 1 个上游调用、1 个流程、LOW；`registerCompiledKnowledge` 2 个上游调用（摄入与历史迁移）、2 个流程、LOW；`recoverRunning` 1 个上游调用、LOW。`ingestWikiSource` 精确符号 walk 返回 UNKNOWN，因图中未表达 dependency injection 属性调用；源码搜索确认 compileSource、两条作业服务注入路径和直接调用位置，按实际边界进行修改和回归验证。未观察到 HIGH/CRITICAL 风险。
- 变更前记录用户已有未提交文件；不触碰上述 CSS 文件。

## 任务计划

| TP | 任务 | 状态 | 产出 | 验证 |
|---|---|---|---|---|
| TP-001 | 增加每作业项持久提交记录、迁移和 repository | 已完成 | migration、commit repository、测试 | migration/repository tests、server typecheck |
| TP-002 | 分离编译与落盘，提供可持久化编译快照 | 已完成 | compiler、manifest/file APIs、测试 | compiler/file/manifest tests |
| TP-003 | 接入可幂等副作用与作业恢复、Chat item 独立提交 | 已完成 | lifecycle/search/job services、测试 | ingestion/job/lifecycle integration tests |
| TP-004 | 构造真实进程退出与重启恢复 Harness 探针 | 已完成 | process-smoke 脚本、最终证据与文档回写 | crash process smoke、Harness verify、build/format |

## 检查命令

- 基线/局部：`npm run --workspace=server test -- <focused test paths>`
- 定向 typecheck：`npm run typecheck -w mint-server`
- 真实崩溃探针：`node --import tsx server/scripts/wiki-ingestion-crash-smoke.ts`
- Harness 文档检查：`npm run harness:inspect -- --change 2026-09-23-wiki-ingestion-crash-recovery`
- Harness 验证：执行 AC 相关定向 unit、boundary integration 和 `process-smoke` 崩溃探针；完整默认检查的环境限制记录在 traceability。
- 最终：`npm run build -w mint-server`、`npx prettier --check <本变更修改的 TS/JSON 文件>`、`git diff --check`

浏览器验收：不适用，变更纯后端、无用户界面或用户流程变化。

## 执行记录

### TP-001

- 状态：已完成
- 影响分析：GitNexus exact target `ingestWikiSource` 为 UNKNOWN，源码调用检索确认 DI 调用边界；本 TP 未改变该调用关系。
- 产出文件：`server/migrations/index.ts`、`server/repositories/wikiIngestionCommitRepository.ts`、对应 repository/migration tests。
- 验证：迁移/repository/jobStore 定向测试 16/16 通过；`npm run typecheck -w mint-server` 通过；修改文件 Prettier 与 `git diff --check` 通过。
- 问题/偏差：GitNexus exact target `ingestWikiSource` 为 UNKNOWN，源码调用检索补充确认直接和依赖注入调用；未观察到 HIGH/CRITICAL 风险。浏览器验收不适用。

### TP-002

- 状态：已完成
- 产出文件：`server/services/utils/wikiCompiler.ts`、`server/services/utils/wikiShared.ts`、对应 compiler/shared tests。
- 验证：compiler/shared 定向测试 27/27 通过；最终聚合 unit 包含 compiler/shared 回归；修改文件 Prettier、`git diff --check` 通过。
- 问题/偏差：编译快照只在校验完成后持久化；原有同步入口保留默认写入行为。

### TP-003

- 状态：已完成
- 产出文件：`server/services/api/wikiIngestionService.ts`、`wikiFileService.ts`、`wikiIngestionJobService.ts`、`wikiKnowledgeLifecycleService.ts` 与相关测试。
- 验证：摄入/job/lifecycle 定向测试通过；覆盖 Source、页面、生命周期、搜索索引、manifest 的恢复和重复执行；Chat item 使用独立稳定身份。
- 问题/偏差：提交记录提供向前恢复边界；父作业未到成功终态前保留所有 item 输入，终态时再统一清理。

### TP-004

- 状态：已完成
- 产出文件：`server/scripts/wiki-ingestion-crash-smoke.ts`。
- 验证：真实子进程在首个 Chat item 的 lifecycle 已提交、checkpoint 未写入时以 86 退出；另一个进程提交首项后以 87 退出，确认父作业未终态时暂存输入仍保留。新进程启动真实 Wiki ingestion worker 自动恢复两个独立 item。重复恢复后 Source/Page/Claim/support/event/search/manifest 计数稳定，父作业终态后暂存目录清空。
- 问题/偏差：标准 Harness 的全量 unit 在受限环境中遇到本地监听 `EPERM` 与 SQLite readonly 环境错误；改用 AC 相关定向 unit、boundary integration 和 process-smoke 检查做 claim 聚合，并保留完整失败证据。

### 2026-09-23：Harness run 2026-09-23T14-17-15-544Z-80211

- 状态：failed
- TP：TP-001
- 轮次：1
- 证据目录：.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-17-15-544Z-80211
- 检查结果：unit:failed, claims:FAIL

### 2026-09-23：Harness run 2026-09-23T14-21-48-850Z-86301

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-21-48-850Z-86301
- 检查结果：unit:passed, boundary:passed, crash-recovery-smoke:passed, claims:UNVERIFIED

### 2026-09-23：Harness run 2026-09-23T14-22-14-884Z-86614

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-22-14-884Z-86614
- 检查结果：unit:passed, boundary:passed, crash-recovery-smoke:passed, claims:PASS

### 2026-09-23：Harness run 2026-09-23T14-26-55-782Z-91192

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-26-55-782Z-91192
- 检查结果：unit:passed, boundary:passed, crash-recovery-smoke:passed, claims:PASS

### 2026-09-23：Harness run 2026-09-23T14-30-37-397Z-96787

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-30-37-397Z-96787
- 检查结果：unit:passed, boundary:passed, crash-recovery-smoke:passed, claims:PASS
