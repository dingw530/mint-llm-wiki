# 验收一致性审计：Memory 分层与空间召回

## 结论

最终 Harness run `2026-10-01T03-18-43-494Z-40308` 状态为 `completed`，claim 聚合状态为 `PASS`。`claim-verification.json` 中 AC-001～AC-013 共 13 条均为 PASS，required evidence level 已满足，所有声明 invariants 均通过关联 probe。

证据根目录：`.harness/runs/2026-09-30-memory-context-optimization/2026-10-01T03-18-43-494Z-40308/`。逐条 machine-readable 结果见 `claim-verification.json`；检查记录分别在 `server-regression.log`、`client-regression.log`、`memory-unit.log`、`memory-integration.log`、`memory-entry.log`、`memory-lifecycle.log`、`memory-quality.log`、`memory-process.log`、`browser-ac.log`、`memory-static.log`、`boundary.log`、`coverage.log`、`electron-smoke.log`。

## 规格到证据核对

| 范围                         | 结果     | 主要证据                                                                                                     |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| US/FP/BR/NF → DS/API → TP/AC | 已追溯   | `product-spec.md`、`design-doc.md`、`exec-plan.md` 与本目录 `traceability.md`                                |
| AC-001～AC-006               | 6/6 PASS | migration/scope/FTS/packing/entry integration 与 unit probes                                                 |
| AC-007、AC-009               | 2/2 PASS | memory entry integration；4 个浏览器流程及请求、trace、截图                                                  |
| AC-008、AC-011               | 2/2 PASS | CLI chat/REPL isolated process smoke、worker lifecycle、Electron bundle shutdown smoke                       |
| AC-010                       | PASS     | domain boundary、typecheck、server/Electron/MCP/client builds 与 entry probe                                 |
| AC-012                       | PASS     | content-free observation 与 selected-access unit/integration probes                                          |
| AC-013                       | PASS     | 固定 30 cases、26 个词法可回答案例、10,000 条 fixture；Recall@8=1.0、无关注入率=0、跨空间误取=0、p95=1.453ms |

质量报告及完整逐案例排序：`evidence/implementation/TP-008/quality-report.json`。报告同时保存旧 24+8 基线：Recall@8=0.9615、无关注入率=0.9665。测试机器为 Node 20.19.4、SQLite 3.51.3、Apple M1 Pro；本结果只适用于该固定词法 fixture 与本机基准。

## 用户历史数据库修复

用户授权后，对当前 Mint 数据库只输出 scope/status 计数并经正式 assignment endpoint 修复：migration #32 后共有 121 条 active/unassigned 记录，其中 37 条没有不同内容的同键冲突，已归入 `global`；其余 84 条分属 7 个同键冲突组，继续保持 `unassigned`，等待用户决定冲突事实的取舍。修改前已生成 `~/.mint/data.db.pre-memory-repair-20261001` 快照。修复后通过前端 `/api` 代理只读验证 `global=37`、`unassigned=84`，HTTP 200。具体计数见 `evidence/implementation/TP-008/live-history-repair.json`；没有把正文输出到工具日志。

这 84 条不自动采用“最新更新时间覆盖旧值”：那会改变仍为 active 的事实语义，需用户选择。当前 `memoryEnabled=false`，因此将记录归属到 global 之后，还需启用记忆功能，回答流程才会使用它们。

## 实施反馈闭环

执行中暴露并修复了以下问题，修复后对应 probe 及最终 Harness 均通过：

- 声明式 memory list endpoint 的 optional 参数可能因 extractor 省略 undefined 值而错位；改为传完整 query 对象，并同步 HTTP、client、preload 与 manifest 参数契约。
- 真实库复核进一步发现 unnamed query descriptor 在 Express 提取和 Client Manifest 序列化两处均丢失筛选对象；已修复，HTTP 与 IPC 统一传 query object，并新增 helper、URL 构建和真实路由回归。
- 旧的最小 recovery fixture 没有完整 memory 表；migration #32 现在兼容该旧 fixture，并增加迁移回归。
- browser glob `**/api/agents*` / `**/api/memories*` 会同时匹配 Vite 模块路径 `/src/services/api/...`；当前 change 场景将 mocks 锚定到 `http://localhost:5800/api/...`，四个 AC 场景通过。
- endpoint integration fixture 将随机端口请求 host 固定为 `127.0.0.1`，避免覆盖率运行时 localhost 协议解析不稳定；该 suite 33/33 通过，全量 coverage 通过。

## 限制与审计能力

本次没有使用真实模型 API 或外部 ingest。AC-013 证明词法召回 fixture 和本机 SQLite 负载目标，不证明无词面重合的语义召回、真实模型使用/遵循记忆、其他硬件的延迟或供应商真实 token 计数。用户授权后的 live DB 操作限定为创建快照、批量 scope assignment 和读取计数；没有输出记忆正文。

未进行独立第三方代码审阅。主代理根据 claim 聚合、测试与实际进程/browser 证据完成交叉核对，不能将该自审称为独立审计；独立审计能力因此降级。上位 `2026-09-29-server-structure` 的非 Memory TP 仍未完成。
