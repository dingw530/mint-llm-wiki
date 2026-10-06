# 产品规格：记忆语义键归一化

状态：已完成。日期：2026-10-01。关联：[设计](design-doc.md)、[计划](exec-plan.md)、[追溯](traceability.md)。

## 背景与目标

US-001：用户用不同措辞表达同一偏好时，希望记忆可正确常驻、修正和撤销。FP-001：新增 Jev 优先、LLM 降级的语义识别；FP-002：识别后统一 key 再匹配旧事实。

## 范围与规则

BR-001：受约束输出回答语言、回答风格、职业、时区、other、uncertain。识别置信度至少 0.8 才规范化为标准 key。BR-002：明确 other/uncertain/低置信度是终局，只在不可用时降级。BR-003：归一化不改变主体和作用域；自动常驻仍必须满足原有来源、类型、作用域、提取置信度检查。识别失败原键保留且按需召回。BR-004：Jev 复用记忆实验开关/凭据；LLM 复用当前 AI 适配器，独立结构化调用。

非目标：不修改 UI/API/schema，不自动重写存量别名，不推断实体身份或向量召回，不修改自动遗忘策略。浏览器验收不适用，行为由后台任务及 SQLite 集成验证。

## 验收标准

| AC     | 可观察行为                                                                   | 风险   | 不变量                       | 最低证据    | TP / probe                    |
| ------ | ---------------------------------------------------------------------------- | ------ | ---------------------------- | ----------- | ----------------------------- |
| AC-001 | 别名事实经语义识别归一化后再匹配旧事实，UPDATE/DELETE 命中标准键，重复不新增 | medium | `normalization_before_write` | integration | TP-001 / semantic-integration |
| AC-002 | Jev 优先；不可用或非法响应才降级 LLM；other/uncertain/低置信度不翻案         | medium | `asymmetric_fallback`        | unit        | TP-001 / semantic-unit        |
| AC-003 | 识别与提取置信度独立；来源/主体/作用域校验保留；无法识别只按需召回           | medium | `conservative_core`          | integration | TP-001 / semantic-integration |
| AC-004 | 任务与兼容入口注入相同识别器；取消后不降级、不落库；有界超时；无新跨域依赖   | medium | `bounded_shutdown`           | integration | TP-001 / semantic-integration |

## 风险与依赖

误判可能合并不同事实，必须受约束类型、高置信度及现有主体/作用域限制；sourceMessageId 缺失不得自动常驻。识别默认总预算 15 秒，整体提取沿用 180 秒上限，复用 shutdown signal。真实提供商语义准确率不由模拟响应测试证明，当前只验证协议与控制流。
