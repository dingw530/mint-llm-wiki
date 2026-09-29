# 追溯总览：Wiki 摄入提交崩溃恢复

## 变更状态

| 属性 | 值 |
|---|---|
| 变更 | 2026-09-23-wiki-ingestion-crash-recovery |
| 当前阶段 | 已完成 |
| 开始日期 | 2026-09-23 |
| 完成日期 | 2026-09-23 |

## 需求到设计到执行追溯

| 需求 | 设计 | 执行任务 | 当前证据状态 |
|---|---|---|---|
| BR-001/002，AC-001 | DS-001/002/004 | TP-001/002/003/004 | PASS：unit + process-smoke，恢复 worker 复用已存快照 |
| BR-003，AC-002/003 | DS-001/003 | TP-001/002/003/004 | PASS：unit + boundary + process-smoke，副作用及稳定路径计数不变 |
| BR-004，AC-001/004 | DS-001/002/005 | TP-002/003/004 | PASS：子进程退出码 86，新进程启动 worker 完成恢复 |
| BR-005，AC-005 | DS-001/004 | TP-001/003/004 | PASS：Chat item 独立 key，两个 item 分别提交且无重复副作用 |
| BR-006，AC-006 | DS-002/003/004 | TP-002/003/004 | PASS：旧正式路径、证据失败清理与普通成功失败回归 |

## TP 执行记录

| TP | 当前状态 | 产出文件 | 验证结果 | 备注 |
|---|---|---|---|---|
| TP-001 | 已完成 | migration、提交 repository 与测试 | migration/repository tests、server typecheck、Prettier、diff check PASS | GitNexus 上游 LOW；`ingestWikiSource` 保留 UNKNOWN 并由源码调用链补充审查 |
| TP-002 | 已完成 | compiler、页面/索引写入与 manifest 稳定操作 | compiler/shared 定向测试、最终聚合 unit PASS | 编译结果先持久化为快照，再进入副作用提交 |
| TP-003 | 已完成 | ingestion、file、lifecycle、search 与 job service | job item 独立身份测试和完整定向回归 PASS | 归档附件保持稳定路径；仅父作业终态清理暂存输入 |
| TP-004 | 已完成 | `server/scripts/wiki-ingestion-crash-smoke.ts` | process-smoke PASS：两 Chat items 恢复，Sources/Pages/Claims=2，support 最小值=1，events=4，search docs=4，manifest=2，暂存文件=0 |

## Harness 证据

- 浏览器场景：不适用（纯后端变更）。
- 验证计划：`verification-plan.json`。
- 证据目录：`.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-30-37-397Z-96787`。
- 声明：命令成功不自动代表 AC PASS；由 Harness 按 claim/probe/evidence/invariant 聚合。
- AC 聚合：AC-001 至 AC-006 全部 PASS。
- 定向检查：7 个服务端测试文件；boundary 架构检查；真实进程退出/worker 恢复探针。
- 构建与静态检查：server typecheck、server build、修改文件 Prettier、`git diff --check` PASS。
- 审计级别：主执行代理完成逐 TP/AC 自审，无独立审计代理；达到本地 runtime/进程级证据，不声明独立 L4 审计或目标环境 L5。

## 偏差记录

| 日期 | 类型 | TP | 文件 | 原因 | 影响 | 后续动作 |
|---|---|---|---|---|---|---|

## 交接

- 当前进度：P0 规划、设计、实现及 AC 级 Harness 证据已完成。
- 下一步：无；默认 Harness 全量检查仍应在允许本机监听与隔离 SQLite 的环境重新运行。
- 已知限制：文件系统、SQLite 与外部向量库仍不构成一个原子事务；本协议采用持久 journal 向前恢复。GitNexus CLI 本轮无法启动，其本地入口尝试访问 npm registry 被网络策略拒绝；继续沿用前置影响分析和源码调用链审查。

### 2026-09-23：Harness run 2026-09-23T14-17-15-544Z-80211

- 状态：failed
- TP：TP-001
- 轮次：1
- 证据目录：.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-17-15-544Z-80211
- 检查结果：unit:failed, claims:FAIL
- 说明：全量 unit 中 4 项因本环境禁止本机监听（`listen EPERM`）失败，另 1 项使用默认 SQLite 路径时出现 readonly；不代表本变更业务断言失败。

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
- 说明：本运行使用 Harness `--checks` 注入 AC 相关的定向检查，不等同于默认全量检查。

### 2026-09-23：Harness run 2026-09-23T14-26-55-782Z-91192

- 状态：completed
- TP：未指定（所有 TP 已完成）
- 轮次：1
- 证据目录：.harness/runs/2026-09-23-wiki-ingestion-crash-recovery/2026-09-23T14-26-55-782Z-91192
- 检查结果：定向 unit:passed, boundary:passed, 两 Chat item crash-recovery-smoke:passed, claims:PASS
- process-smoke 观察值：退出码 86（生命周期提交后）与 87（首条提交完成、父作业未完成）；父作业未终态时首条输入仍存在。重启后 Source/Page/Claim=2；每条 Claim support=1；events=4；search documents=4；manifest entries=2；父作业终态后残留暂存文件=0。

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
- process-smoke 观察值：退出码 86 与 87；首项提交后父作业未终态时输入仍保留。重启后两条 Chat item 均完成；Source/Page/Claim=2，Claim support=1，事件=4，搜索文档=4，manifest=2，最终暂存文件=0。
