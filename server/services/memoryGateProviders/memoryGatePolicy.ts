import { getErrorMessage } from '../../utils/typeGuards.js';
import { createJevMemoryGateProvider } from './jevMemoryGateProvider.js';
import { createLegacyMemoryGateProvider } from './legacyMemoryGateProvider.js';
import type {
  MemoryGateAttempt,
  MemoryGateConfig,
  MemoryGateInput,
  MemoryGateOutcome,
  MemoryGateProvider,
  MemoryGateResolution,
} from './types.js';

/** provider 无状态单例，配置每次由 policy 传入。 */
const JEV_MEMORY_GATE_PROVIDER = createJevMemoryGateProvider();
const LEGACY_MEMORY_GATE_PROVIDER = createLegacyMemoryGateProvider();

/** Jev 开启时优先尝试的 provider 列表。 */
export const DEFAULT_MEMORY_GATE_PROVIDERS: readonly MemoryGateProvider[] = [
  JEV_MEMORY_GATE_PROVIDER,
];

/**
 * 执行单个 provider，并把意外异常收敛为 `unavailable`。
 * @param provider 待执行的 provider
 * @param input 门控输入
 * @param config provider 配置
 * @returns provider 结论；抛异常时返回 unavailable
 */
async function runProvider(
  provider: MemoryGateProvider,
  input: MemoryGateInput,
  config: MemoryGateConfig,
): Promise<MemoryGateOutcome> {
  try {
    return await provider.evaluate(input, config);
  } catch (error) {
    return { kind: 'unavailable', reason: 'unknown', message: getErrorMessage(error) };
  }
}

/**
 * 依次尝试 Jev 侧 provider。
 * 只有全部 `unavailable` 时才返回 null；`memorize` 与 `skip` 都是终局结论。
 * @param input 门控输入
 * @param config provider 配置
 * @param providers 有序 provider 列表
 * @param attempts 累积的尝试轨迹
 * @returns 终局结论，或 null 表示需要回退
 */
async function tryJevProviders(
  input: MemoryGateInput,
  config: MemoryGateConfig,
  providers: readonly MemoryGateProvider[],
  attempts: MemoryGateAttempt[],
): Promise<MemoryGateResolution | null> {
  for (const provider of providers) {
    const startedAt = Date.now();
    const outcome = await runProvider(provider, input, config);
    const latencyMs = Date.now() - startedAt;

    if (outcome.kind === 'unavailable') {
      attempts.push({
        providerId: provider.id,
        outcome: 'unavailable',
        reason: outcome.reason,
        latencyMs,
      });
      continue;
    }

    attempts.push({ providerId: provider.id, outcome: outcome.kind, latencyMs });
    return outcome.kind === 'memorize'
      ? { memorize: true, providerId: provider.id, hint: outcome.hint, attempts }
      : { memorize: false, providerId: provider.id, attempts };
  }

  return null;
}

/**
 * 解析本次记忆门控结论。
 *
 * **降级是不对称的**：Jev 的 `memorize` 与 `skip` 都是终局，不会再去问原有启发式 ——
 * 否则 Jev 判定"不值得记"之后，正则几乎一定判"值得"，门控就完全失效了。
 * 只有 Jev 不可用（未配置、超时、限流、响应不可解析）才回退到原有启发式。
 *
 * @param input 门控输入
 * @param config provider 配置
 * @param jevProviders Jev 开启时优先尝试的 provider
 * @returns 门控结论与尝试轨迹
 */
export async function evaluateMemoryGate(
  input: MemoryGateInput,
  config: MemoryGateConfig,
  jevProviders: readonly MemoryGateProvider[] = DEFAULT_MEMORY_GATE_PROVIDERS,
): Promise<MemoryGateResolution> {
  const attempts: MemoryGateAttempt[] = [];

  if (config.jev.memoryEnabled) {
    const resolved = await tryJevProviders(input, config, jevProviders, attempts);
    if (resolved) return resolved;
  }

  const startedAt = Date.now();
  const legacy = await runProvider(LEGACY_MEMORY_GATE_PROVIDER, input, config);
  attempts.push({
    providerId: LEGACY_MEMORY_GATE_PROVIDER.id,
    outcome: legacy.kind,
    reason: legacy.kind === 'unavailable' ? legacy.reason : undefined,
    latencyMs: Date.now() - startedAt,
  });

  return {
    memorize: legacy.kind === 'memorize',
    providerId: LEGACY_MEMORY_GATE_PROVIDER.id,
    attempts,
  };
}
