# 设计：记忆语义键归一化

状态：已完成。关联：[规格](product-spec.md)、[计划](exec-plan.md)。

## 约束与决策

DS-001（AC-001/AC-003）：新增领域语义策略和 type-only port；基础设施实现 Jev→LLM provider；bootstrap 注入任务与兼容入口。领域不导入设置/网络客户端。对每个操作识别，受约束类型映射标准键，发生在事务与 findActiveByKey 之前。明确其他或不确定不得因原 key 正好在白名单而晋升。

DS-002（AC-002）：复用 Jev memoryEnabled，choice 包含 other/uncertain；choice confidence 与提取 confidence 分开。成功低置信度转 uncertain，不调用 LLM。不可用才用 AI adapter 进行 JSON 判别；非法 JSON、未知类型、置信度越界皆保守弃权。

DS-003（AC-004）：provider 有总墙钟预算和外部取消信号；取消后不再调用 LLM，落库前检查 signal；识别串行且受整体提取超时限制。无新 schema，现有状态/有效期/用户保护/手动常驻维持。

## 方案取舍

用户已选定 Jev 优先与 LLM 降级。选择独立判别请求保持提供商相同契约；未采用复用提取输出，避免 Jev 明确否定后再让 LLM 翻案。代价是每个事实可能增加一次 Jev 或 LLM 调用；仅对通过写入门控的后台提取执行。

## 验收矩阵

| DS     | AC             | TP     | 证据                                                        |
| ------ | -------------- | ------ | ----------------------------------------------------------- |
| DS-001 | AC-001、AC-003 | TP-001 | 真实 SQLite：别名更新/去重/撤销、scope isolation、core/检索 |
| DS-002 | AC-002         | TP-001 | 受控 Jev/adapter 输出：终局/降级/格式校验                   |
| DS-003 | AC-004         | TP-001 | 取消/超时测试、worker lifecycle、架构与构建                 |
