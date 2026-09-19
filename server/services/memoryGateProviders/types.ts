import type { JevSettings, MemoryOperationAction } from '../../types.js';
import type { JevFailureReason } from '../jev/types.js';

/** 记忆门控输入：触发本轮提取的用户消息。 */
export interface MemoryGateInput {
  userContent: string;
  conversationId?: string;
}

/** 门控命中时携带的先验，用于审计；本期不回灌提取提示词。 */
export interface MemoryGateHint {
  category: string;
  importance: number;
  action: MemoryOperationAction;
  confidence: number;
  /** Jev 的 noul 值。 */
  worth: number;
}

/** 判定为不值得记忆的原因。 */
export type MemoryGateSkipReason = 'too_short' | 'greeting' | 'not_worth_remembering';

/** provider 的门控结论。 */
export type MemoryGateOutcome =
  | { kind: 'memorize'; hint?: MemoryGateHint }
  | { kind: 'skip'; reason: MemoryGateSkipReason }
  | { kind: 'unavailable'; reason: JevFailureReason; message: string };

/** 一个可替换的记忆门控来源。实现之间不得互相引用。 */
export interface MemoryGateProvider {
  readonly id: string;
  evaluate(input: MemoryGateInput, config: MemoryGateConfig): Promise<MemoryGateOutcome>;
}

/** provider 的配置来源。 */
export interface MemoryGateConfig {
  jev: JevSettings;
}

/** 一次 provider 尝试的审计记录。 */
export interface MemoryGateAttempt {
  providerId: string;
  outcome: 'memorize' | 'skip' | 'unavailable';
  reason?: string;
  latencyMs: number;
}

/** 门控的最终结论。 */
export interface MemoryGateResolution {
  /** 是否应入队记忆提取。 */
  memorize: boolean;
  /** 作出最终结论的 provider id；无可用 provider 时为 null。 */
  providerId: string | null;
  hint?: MemoryGateHint;
  attempts: MemoryGateAttempt[];
}
