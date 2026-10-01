# 产品规格：记忆界面默认全局

## 文档信息

| 属性     | 值                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------ |
| 编号     | SPEC-20261001-MEMORY-UI                                                                          |
| 状态     | 已完成；AC-001～AC-003 全部 PASS                                                                 |
| 日期     | 2026-10-01                                                                                       |
| 关联     | [design-doc.md](design-doc.md)、[exec-plan.md](exec-plan.md)、[traceability.md](traceability.md) |
| 相关变更 | [记忆分层与空间召回](../2026-09-30-memory-context-optimization/product-spec.md)                  |

## 目标

简化记忆设置和聊天界面，默认按用户全局记忆使用。隐藏知识空间创建、筛选、归属编辑和聊天绑定控件；保留已存在的服务端 scope、空间数据及已绑定会话行为。

## 范围与非目标

- 移除记忆设置中的知识空间管理、scope 过滤、空间归属选择与空间名称标签；新建手动记忆固定写入用户全局。
- 移除聊天头部的会话记忆空间选择控件和对应的界面查询/写入调用。
- 全局及待归属历史记忆仍可管理；待归属历史可批量归入用户全局。
- 已存在的空间绑定与空间记忆继续由后端作用域逻辑处理；本变更不改数据库、不删空间、不改变召回算法。
- 不新增 workspace 自动识别、历史冲突自动合并或任何迁移。

## 验收标准

| AC     | 可观察行为                                                                                              | 风险   | 不变量                                                                     | 最低证据             | TP / probes                        |
| ------ | ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- | -------------------- | ---------------------------------- |
| AC-001 | 记忆设置和聊天头部不再显示知识空间管理、筛选或绑定控件，也不请求空间列表/绑定 UI API。                  | medium | `no_space_controls`, `no_space_ui_requests`                                | unit, browser        | TP-001 / `memory-ui`, `browser-ac` |
| AC-002 | 手动新建记忆自动提交 `scopeKind=global, spaceId=null`；待归属旧记忆仍可见，批量归属目标固定为用户全局。 | high   | `manual_memory_global_default`, `legacy_visible`, `global_assignment_only` | integration, browser | TP-001 / `memory-ui`, `browser-ac` |
| AC-003 | 界面移除后，既有会话绑定仍由服务端 scope 解析；未绑定会话仍召回 global；已绑定会话仍遵循内部空间隔离。  | high   | `bound_scope_preserved`, `unbound_global`, `scope_isolation`               | integration          | TP-002 / `memory-scope`            |
