# 追溯总览：Jev 实验性 Wiki Rerank

变更标识：`2026-09-19-jev-rerank-experimental`
状态：执行中

| 需求/规则                         | 验收   | 设计                 | 执行任务      | 状态   |
| --------------------------------- | ------ | -------------------- | ------------- | ------ |
| provider 抽象、legacy 与 Jev 实现 | AC-001 | DS-001/DS-002/DS-003 | TP-001/TP-002 | 已完成 |
| 默认行为兼容                      | AC-002 | DS-002/DS-004        | TP-001/TP-002 | 已完成 |
| Jev Top-K 语义判断                | AC-003 | DS-003               | TP-002        | 已完成 |
| 失败整次回退                      | AC-004 | DS-004               | TP-002        | 已完成 |
| 实验开关与持久化                  | AC-005 | DS-005               | TP-003        | 已完成 |
| 结构化观测且不泄露密钥            | AC-006 | DS-006               | TP-002        | 已完成 |
| 无 migration、边界与格式          | AC-007 | DS-005/DS-006        | TP-004        | 进行中 |

## 执行记录

| TP     | 状态   | 产出文件                                                              | 验证                                                                                                                    | 问题                                                               |
| ------ | ------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| TP-001 | 已完成 | `server/services/rerank/`、`server/services/api/wikiSearchService.ts` | rerank、Wiki search/hybrid 测试；server `tsc --noEmit`                                                                  | 保留 legacy RRF 语义，未改召回链路                                 |
| TP-002 | 已完成 | `jevRerankProvider.ts`、`rerankPolicy.ts`、rerank 测试                | Jev 成功、异常、超时/失败回退测试                                                                                       | 未进行真实 TypeSafe 线上质量验证                                   |
| TP-003 | 已完成 | settings 类型/service/endpoint、Jev 表单与组件                        | server settings/endpoint 测试；client `tsc --noEmit`；client 83 tests                                                   | rerank 开关与路由、记忆开关独立                                    |
| TP-004 | 进行中 | `verification-plan.json`、Harness run artifacts                       | inspect 通过；unit 943/943、coverage、boundary、lifecycle、signal、browser-ac 通过；Prettier 与 `git diff --check` 通过 | Docker smoke 被容器内 Electron 下载网络失败/超时阻塞；未 writeback |

## 偏差表

| 2026-09-19 | TP-004 | Harness Docker smoke 未完成 | Docker build 在容器内执行 `npm ci` 时 Electron 下载先后出现 `socket hang up` 与 900 秒超时；业务测试与静态检查不受影响，待网络/缓存可用后重跑 Harness。 |
