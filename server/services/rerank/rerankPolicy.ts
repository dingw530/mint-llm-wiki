import { createJevRerankProvider } from './jevRerankProvider.js';
import { createLegacyRerankProvider } from './legacyRerankProvider.js';
import type { RerankInput, RerankProvider, RerankProviderConfig, RerankOutcome } from './types.js';

const LEGACY_PROVIDER = createLegacyRerankProvider();
const JEV_PROVIDER = createJevRerankProvider();

/** 默认 rerank provider 列表；顺序表示实验 provider 优先、legacy 永远兜底。 */
export const DEFAULT_RERANK_PROVIDERS: readonly RerankProvider[] = [JEV_PROVIDER, LEGACY_PROVIDER];

async function runLegacy(
  input: RerankInput,
  config: RerankProviderConfig,
  legacy: RerankProvider,
): Promise<RerankOutcome> {
  return legacy.rerank(input, config);
}

/** 选择 rerank provider；Jev 关闭或失败时整次回退 legacy。 */
export async function rerankCandidates(
  input: RerankInput,
  config: RerankProviderConfig,
  providers: readonly RerankProvider[] = DEFAULT_RERANK_PROVIDERS,
): Promise<RerankOutcome> {
  const legacy = providers.find((provider) => provider.id === 'legacy') ?? LEGACY_PROVIDER;
  if (!config.jev.rerankEnabled) return runLegacy(input, config, legacy);
  const jev = providers.find((provider) => provider.id === 'jev') ?? JEV_PROVIDER;
  const result = await jev.rerank(input, config);
  if (result.kind === 'ranked') return result;
  const fallback = await runLegacy(input, config, legacy);
  return fallback.kind === 'ranked'
    ? { ...fallback, providerId: `legacy:fallback:${result.reason}` }
    : fallback;
}
