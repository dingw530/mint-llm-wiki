# 设计文档：Wiki 摄入提交崩溃恢复

## 文档信息

| 属性 | 值 |
|---|---|
| 变更标识 | 2026-09-23-wiki-ingestion-crash-recovery |
| 状态 | 已完成 |
| 关联规格 | [product-spec.md](product-spec.md) |

## 背景与目标

已有 SQLite 队列可在启动时把 `parsing`、`compiling`、`committing` 作业重新排队；但 `compileSource` 会先写页面，再由 `ingestWikiSource` finalize Source、注册生命周期、重建索引并追加 manifest。崩溃恢复当前只是重跑整个作业，没有持久化已生成的编译结果，也没有一个覆盖上述副作用的稳定提交身份。

目标是保留现有单 worker 队列和启动 drain，把 P0 收敛到**可持久化快照的向前提交协议**：LLM 输出成功后先保存编译快照，然后所有写入基于该快照并且可以安全重放。

## 约束

- 文件系统和 SQLite 无法由同一事务原子提交。
- 同一个 Chat 作业包含多个相互独立的资料项。
- 外部向量库可能暂时不可用；现有 FTS 索引是本地可重建数据。
- 不修改公开 HTTP/IPC 请求响应，不改写用户已有的 UI 工作。
- P0 验证必须观察真实子进程退出与新进程恢复；mock-only 不够。

## 方案选择

### 方案 A：启动后从输入重新编译并重试

复用现有行为，改动最少。但 LLM 输出非确定，编译器可能已写出页面，Source 可能已移动，生命周期事件和 manifest 可能重复，因此不能满足提交幂等。

### 方案 B：持久编译快照 + 稳定提交记录 + 向前恢复（采用）

编译器先返回完整编译结果而不落盘；将该结果与作业项身份、Source 目标和提交阶段写入 SQLite。之后页面、Source、生命周期、搜索和 manifest 均由同一快照驱动。每项操作可重放；阶段完成后更新 journal。若在“副作用已生效、阶段标记尚未写入”之间退出，副作用本身仍必须按稳定键幂等。

采用原因：无需分布式事务，也不重复调用非确定的 LLM；用本地持久记录明确界定恢复进度。

### 方案 C：整个 Wiki 提交包在文件系统原子 rename

SQLite 生命周期、FTS 数据、外部向量索引和 manifest 仍不在同一文件系统事务里，不能消除部分提交，也会显著改变当前 Wiki 存储布局，故不采用。

## 最终设计

### DS-001：每作业项一条持久提交记录

在 SQLite migration 中新增摄入提交记录，主键为稳定 `commit_id`，并对 `(job_id, item_key)` 建唯一约束。记录至少包含 `wiki_path`、输入 Source 路径、目标正式 Source 路径、编译快照 JSON、稳定 manifest ID、当前阶段、创建/更新时间及最后错误。阶段单向推进，例如：

```text
prepared → source_finalized → pages_written → lifecycle_registered
         → search_indexed → manifest_written → committed
```

DDL 同时加入新数据库 schema 和迁移，遵守现有数据库演进约定。编译快照只在编译和证据校验成功后落库。恢复时若已有快照，直接从其当前阶段续跑；没有快照则从持久化输入开始编译。

### DS-002：编译与落盘分离

给 Wiki compiler 增加显式的“只编译”能力，返回完整页面、claims、relationships、摘要和编译元数据，但不写 Markdown 或索引文件。已有调用保留默认落盘行为，避免改变非任务式调用的契约。异步任务路径使用只编译，再持久化快照。

### DS-003：幂等副作用

- **Source**：提交记录预先保存稳定目标路径。恢复时以原子复制保留暂存输入；多个原始附件也按提交身份生成稳定路径。目标冲突且内容不匹配时失败关闭，不覆盖用户文件。整个父作业到达成功终态后才统一清理所有条目的暂存输入，避免较早完成的 Chat 条目在作业恢复前丢失解析输入。
- **页面**：快照固定目标 path/content。通过现有原子文件写入/稳定 path + content hash 重放；页面此前存在时沿用编译阶段已确定的合并结果，禁止恢复时重新调用 LLM 合并。
- **生命周期**：延续仓储层 `(path, content_hash)` 唯一约束；仅在发现同一 source 已有相同 page/claim 结果时跳过创建/强化事件，确保“数据库事务已提交但阶段标记没来得及写入”时重放不增加 support count。
- **搜索**：复用 document ID 的 upsert/replace 语义重新构建 FTS；向量同步复用已有稳定文档 ID。
- **Manifest**：持久化稳定 manifest ID，新增按 ID upsert/ensure-existing 的操作，重复调用不 append 重复条目。
- **图谱与跨批候选**：按现有能力重建/去重；跨批候选仍为 best effort，不阻塞主提交完成。

### DS-004：作业恢复和多文件隔离

启动恢复仍由 `recoverRunning()` 与现有 startup drain 负责。每个上传单文件使用 job ID 作为 item key；Chat 按输入列表中稳定索引与输入路径生成 item key。worker 先查询对应提交记录：快照已存在则跳过 parse/LLM compile 并恢复该项提交；已 `committed` 则返回持久化结果。每项成功后保存最终结果，再推进作业状态。不同条目互不回滚。

作业创建前的暂存孤儿、多个进程同时运行 worker、外部向量服务的数据一致性 SLA 不属于本次恢复协议。

### DS-005：进程故障验证

为提交协调器提供仅通过依赖注入的阶段回调；生产默认无副作用。测试子进程在指定阶段回调中调用 `process.exit(86)`。父测试进程确认子进程异常退出后启动新 worker，共用临时 SQLite 与 Wiki 目录，再断言任务终态、LLM 调用数、Source/Page/Claim/事件/manifest/搜索计数及阶段记录。至少覆盖 Source rename 后、生命周期事务提交后、索引更新后和 manifest 写入后退出。

## 影响与风险

- 影响：摄入编排、Wiki compiler、Source 文件服务、生命周期注册、manifest 操作、SQLite migration/repository、对应单测和 process-smoke 脚本。
- 兼容：现有队列状态与外部返回 DTO 不变；旧正式 Source 路径仍按原样处理。
- 风险：编译快照增大 SQLite 数据库；页面正文需完整持久化，后续若体积超出合理范围再单独评估文件型快照。
- 风险：文件写入与 journal 阶段标记之间仍可被强制退出；每个受影响副作用必须按稳定键重放，而不能依赖阶段标记本身保证 exactly-once。
- 风险：外部向量库可能出现暂时不一致；由重建/upsert 修复，不声称跨存储原子事务。

## 发布与验证

- 数据迁移按项目 migration 机制前向创建新表，不修改或清理既有作业与来源。
- 先运行迁移、repository、compiler、file、lifecycle、manifest 与 job service 定向测试。
- 通过真实 child-process exit/resume 探针验证恢复协议。
- 再运行 Harness unit、coverage、boundary 和 process-smoke 检查；纯后端变更，browser scenarios 不适用。
- 运行 server typecheck/build、相关 Prettier 和 `git diff --check`。

## 验收证据矩阵

| AC | 设计 | 主要观察值 | 最低证据 |
|---|---|---|---|
| AC-001 | DS-001/002/004 | 编译调用数为 1；新进程从快照恢复 | process-smoke |
| AC-002 | DS-003 | Source/Page/Claim/event/manifest 数量在重复恢复前后不变 | process-smoke + integration |
| AC-003 | DS-001/003 | 最终路径、hash、索引文档和 manifest ID 一致 | integration + process-smoke |
| AC-004 | DS-005 | 子进程退出码 86；新 worker 完成并满足不变量 | process-smoke |
| AC-005 | DS-004 | 两条目独立提交身份与最终状态 | integration + process-smoke |
| AC-006 | DS-002/003/004 | 旧 payload、失败证据校验和成功路径回归 | integration |
