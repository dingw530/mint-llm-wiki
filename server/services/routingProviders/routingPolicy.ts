import { getErrorMessage } from '../../utils/typeGuards.js';
import { GENERAL_AGENT_ID } from './legacyRoutingProvider.js';
import type {
  AgentRoutingInput,
  AgentRoutingOutcome,
  AgentRoutingProvider,
  RouteMethod,
  RoutingAttempt,
  RoutingProviderConfig,
  RoutingResolution,
  RoutingStep,
} from './types.js';

/**
 * 执行单个 provider，并把意外异常收敛为 `unavailable`。
 * provider 抛异常属于预期外的编程错误，但不应中断路由，因此在此兜底。
 * @param provider 待执行的 provider
 * @param input 路由输入
 * @param config provider 配置
 * @returns provider 结论；抛异常时返回 unavailable
 */
async function runProvider(
  provider: AgentRoutingProvider,
  input: AgentRoutingInput,
  config: RoutingProviderConfig,
): Promise<AgentRoutingOutcome> {
  try {
    return await provider.route(input, config);
  } catch (error) {
    return { kind: 'unavailable', reason: 'unknown', message: getErrorMessage(error) };
  }
}

/**
 * 按顺序尝试各 provider，返回最终路由结论。
 *
 * 降级契约：
 * - `confidence >= minConfidence` 的 `decision` 立即采信；
 * - 低于门槛的 `decision` 记为 `below-threshold` 并继续下一步；
 * - `abstain` 与 `unavailable` 都继续下一步；
 * - provider 抛出异常按 `unavailable` 处理；
 * - 全部步用尽时返回 `general/0/fallback`。
 *
 * @param input 路由输入
 * @param steps 有序 provider 步
 * @param config provider 配置
 * @returns 路由结论与尝试轨迹
 */
export async function resolveRoute(
  input: AgentRoutingInput,
  steps: readonly RoutingStep[],
  config: RoutingProviderConfig,
): Promise<RoutingResolution> {
  const attempts: RoutingAttempt[] = [];

  for (const step of steps) {
    const startedAt = Date.now();
    const outcome = await runProvider(step.provider, input, config);
    const latencyMs = Date.now() - startedAt;

    if (outcome.kind === 'decision') {
      const accepted = outcome.decision.confidence >= step.minConfidence;
      attempts.push({
        providerId: step.provider.id,
        outcome: accepted ? 'decision' : 'below-threshold',
        method: outcome.decision.method,
        confidence: outcome.decision.confidence,
        latencyMs,
      });
      if (accepted) return { ...outcome.decision, attempts };
      continue;
    }

    attempts.push({
      providerId: step.provider.id,
      outcome: outcome.kind,
      reason: outcome.reason,
      latencyMs,
    });
  }

  return { agentId: GENERAL_AGENT_ID, confidence: 0, method: 'fallback', attempts };
}

/**
 * 把 provider 尝试轨迹压成 `routing_logs.method` 的审计串。
 *
 * 只有 `unavailable` 属于降级，会出现在审计串里；`abstain` 与 `below-threshold` 是正常
 * 回退路径，由最终的 `effective` 方法本身表达。因此：
 * - 未发生降级 → 直接返回 `effective`（如 `'jev'`、`'keyword'`、`'fallback'`）；
 * - 发生降级 → 返回 `'jev_unavailable:rate_limited>keyword'` 形式。
 *
 * @param attempts 尝试轨迹
 * @param effective 最终生效的方法
 * @returns 写入 `routing_logs.method` 的字符串
 */
export function formatRoutingLogMethod(
  attempts: readonly RoutingAttempt[],
  effective: RouteMethod,
): string {
  const degraded = attempts.filter((attempt) => attempt.outcome === 'unavailable');
  if (degraded.length === 0) return effective;
  const prefix = degraded.map(
    (attempt) => `${attempt.providerId}_unavailable:${attempt.reason ?? 'unknown'}`,
  );
  return [...prefix, effective].join('>');
}
