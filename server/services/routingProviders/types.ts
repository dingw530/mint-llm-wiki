import type { Agent, JevSettings } from '../../types.js';
import type { JevFailureReason } from '../jev/types.js';

/** 一次路由决策的来源，"原有实现"与"Jev 实现"在此统一。 */
export type RouteMethod = 'keyword' | 'llm' | 'jev' | 'fallback';

/** provider 主动弃权的原因。 */
export type RouteAbstainReason = 'no_match' | 'no_candidates' | 'answer_not_a_candidate';

/** 路由输入：原始消息与全量 Agent（含 general）。 */
export interface AgentRoutingInput {
  message: string;
  agents: readonly Agent[];
}

/** provider 自报的决策结论。 */
export interface AgentRoutingDecision {
  agentId: string;
  /**
   * provider 自报置信度，取值 0~1。
   *
   * **语义由 provider 定义，跨 provider 不可直接比较**：原有实现的 1.0 / 0.9 / 0.6 是
   * 触发关键词的命中强度，`llm` 分支的 0.85 是占位值，Jev 给出的是模型校准后的 choice 置信度。
   * 因此跨 provider 门控只能依靠 `RoutingStep.minConfidence` 的步级阈值，不能共用同一个数字。
   */
  confidence: number;
  method: RouteMethod;
}

/** provider 的返回值。provider 只报告结论，不做阈值判断。 */
export type AgentRoutingOutcome =
  | { kind: 'decision'; decision: AgentRoutingDecision }
  | { kind: 'abstain'; reason: RouteAbstainReason }
  | { kind: 'unavailable'; reason: JevFailureReason; message: string };

/** 一个可替换的路由决策来源。实现之间不得互相引用。 */
export interface AgentRoutingProvider {
  readonly id: string;
  route(input: AgentRoutingInput, config: RoutingProviderConfig): Promise<AgentRoutingOutcome>;
}

/** provider 步：provider 加上该步的置信度门槛；0 表示不做门控。 */
export interface RoutingStep {
  provider: AgentRoutingProvider;
  minConfidence: number;
}

/** provider 的配置来源。 */
export interface RoutingProviderConfig {
  jev: JevSettings;
}

/** 一次 provider 尝试的审计记录。 */
export interface RoutingAttempt {
  providerId: string;
  outcome: 'decision' | 'abstain' | 'unavailable' | 'below-threshold';
  method?: RouteMethod;
  confidence?: number;
  reason?: string;
  latencyMs: number;
}

/** 按顺序尝试全部 provider 之后的最终结论。 */
export interface RoutingResolution {
  agentId: string;
  confidence: number;
  method: RouteMethod;
  attempts: RoutingAttempt[];
}
