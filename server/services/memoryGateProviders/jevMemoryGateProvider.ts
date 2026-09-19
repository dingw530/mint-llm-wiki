import { callJev } from '../jev/jevClient.js';
import { toJevConfig } from '../jev/config.js';
import {
  MEMORY_ACTION_OPTIONS,
  MEMORY_GATE_KEYS,
  buildMemoryGateQuestions,
  buildMemoryGateState,
} from '../jev/questions.js';
import type { JevAnswer } from '../jev/types.js';
import type { MemoryOperationAction } from '../../types.js';
import type { MemoryGateHint, MemoryGateProvider } from './types.js';

/**
 * Jev 记忆门控：一次请求问全「是否值得记忆 / 分类 / 重要度 / 写入动作」。
 * 只有判定值得记忆时才返回 `memorize`；结构不可用的响应按 `unavailable` 处理，
 * 由 policy 回退到原有启发式，而不是当成"跳过"。
 */

/** 判断字符串是否为合法的写入动作。 */
function isMemoryAction(value: string): value is MemoryOperationAction {
  return MEMORY_ACTION_OPTIONS.some((option) => option === value);
}

/** 从 choice 答案中取写入动作；缺失或非法时退回 ADD。 */
function readAction(answer: JevAnswer | undefined): MemoryOperationAction {
  if (answer?.type !== 'choice' || !isMemoryAction(answer.choice)) return 'ADD';
  return answer.choice;
}

/** 从 choice 答案中取分类；缺失时退回 general。 */
function readCategory(answer: JevAnswer | undefined): string {
  return answer?.type === 'choice' ? answer.choice : 'general';
}

/** 从 score 答案中取重要度；缺失时取中间值。 */
function readImportance(answer: JevAnswer | undefined): { importance: number; confidence: number } {
  if (answer?.type !== 'score') return { importance: 0.5, confidence: 0 };
  return { importance: answer.score, confidence: answer.confidence };
}

/**
 * 把四个 question 的答案组装成审计先验。
 * @param answers Jev 归一化答案表
 * @param worth noul 判定值
 * @returns 门控先验
 */
function buildHint(answers: Record<string, JevAnswer>, worth: number): MemoryGateHint {
  const importance = readImportance(answers[MEMORY_GATE_KEYS.importance]);
  return {
    category: readCategory(answers[MEMORY_GATE_KEYS.category]),
    importance: importance.importance,
    action: readAction(answers[MEMORY_GATE_KEYS.action]),
    confidence: importance.confidence,
    worth,
  };
}

/**
 * 构造 Jev 记忆门控 provider。
 *
 * 注意 noul 没有 confidence：判断依据是 `noul` 本身的取值，
 * 低于 `memoryGateThreshold` 即视为不值得记忆。
 *
 * @returns 记忆门控 provider
 */
export function createJevMemoryGateProvider(): MemoryGateProvider {
  return {
    id: 'jev',
    evaluate: async ({ userContent }, config) => {
      const result = await callJev(toJevConfig(config.jev), {
        state: buildMemoryGateState(userContent),
        model: config.jev.model,
        questions: buildMemoryGateQuestions(),
      });

      if (!result.ok) {
        return { kind: 'unavailable', reason: result.reason, message: result.message };
      }

      const worth = result.answers[MEMORY_GATE_KEYS.worth];
      if (worth?.type !== 'noul') {
        // 关键答案缺失等同于没答上来，不能当成"跳过"，否则会静默丢记忆。
        return {
          kind: 'unavailable',
          reason: 'malformed_response',
          message: 'Jev 响应缺少 worth 判定',
        };
      }

      if (worth.noul < config.jev.memoryGateThreshold) {
        return { kind: 'skip', reason: 'not_worth_remembering' };
      }

      return { kind: 'memorize', hint: buildHint(result.answers, worth.noul) };
    },
  };
}
