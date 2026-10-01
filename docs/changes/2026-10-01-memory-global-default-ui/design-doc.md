# 设计文档：记忆界面默认全局

## 决策

1. UI 只管理用户全局记忆与待归属历史，不展示空间记录或空间名称。
2. 手动新建事实固定发送 `scopeKind: 'global'`、`spaceId: null`；待归属批量操作只提供“归入用户全局”。
3. 移除聊天头部 scope selector 及客户端对 `memory-spaces`、`conversations/:id/memory-space` 的 UI 调用。
4. 不改 server repositories、scope service、conversation bindings、migration 或 retrieval policy。现有会话若已绑定空间，server 仍使用原绑定；新会话未绑定时按现有规则只使用 global。
5. 已归属空间的记忆不显示在通用记忆设置列表中，避免隐藏其作用域后被用户误认为 global；这些记录仍留在数据库，并可继续被既有绑定会话召回。

## UI 数据流

- 记忆面板并行请求 `scopeKind=global` 与 `scopeKind=unassigned`，合并显示；类别、策略和历史状态过滤仍可用。
- 不请求空间列表，不显示空间管理区、空间筛选、空间名 badge 或空间写入选项。
- 聊天 UI 不读取或修改会话 scope；发送消息时服务端仍从持久化 conversation binding 解析 scope。

## 证据矩阵

| AC     | 责任位置                                                      | 关键观察                                                                   | probes                    |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| AC-001 | `MemoriesPanel`、`MemoryPanelViews`、`ChatHeader`             | 空间控件和 UI API 调用不存在                                               | `memory-ui`、`browser-ac` |
| AC-002 | `memoryPanelModel`、`memories.ts`                             | create payload 为 global；legacy list 与 bulk assignment 可用              | `memory-ui`、`browser-ac` |
| AC-003 | `messageService`、`memoryContextProvider`、scope repositories | UI 拆除不影响 existing binding；unbound/global 与 bound/space scope 仍隔离 | `memory-scope`            |
