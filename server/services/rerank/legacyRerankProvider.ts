import type {
  RerankCandidate,
  RerankProvider,
  RerankProviderConfig,
  RerankOutcome,
} from './types.js';

/** 现有 RRF 的关键词权重。 */
const LEXICAL_WEIGHT = 0.6;
/** 现有 RRF 的向量权重。 */
const VECTOR_WEIGHT = 0.4;
/** RRF 的平滑常量。 */
const RRF_K = 60;
/** 保持现有分数数量级，避免默认模式的结果展示发生变化。 */
const SCORE_SCALE = 1000;

/** 计算现有关键词/向量融合分。 */
export function baseRrfScore(candidate: RerankCandidate): number {
  const lexicalScore = candidate.lexicalRank ? LEXICAL_WEIGHT / (RRF_K + candidate.lexicalRank) : 0;
  const vectorScore = candidate.vectorRank ? VECTOR_WEIGHT / (RRF_K + candidate.vectorRank) : 0;
  return (lexicalScore + vectorScore) * SCORE_SCALE;
}

/** 为 rerank provider 提供稳定的 legacy 候选顺序。 */
export function sortByBaseRrf(candidates: readonly RerankCandidate[]): RerankCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const scoreDelta = baseRrfScore(right.candidate) - baseRrfScore(left.candidate);
      return scoreDelta || left.index - right.index;
    })
    .map(({ candidate }) => candidate);
}

/** 现有 RRF/关键词规则排序的 provider。 */
export function createLegacyRerankProvider(): RerankProvider {
  return {
    id: 'legacy',
    async rerank(
      input: { candidates: readonly RerankCandidate[] },
      _config: RerankProviderConfig,
    ): Promise<RerankOutcome> {
      return {
        kind: 'ranked',
        providerId: 'legacy',
        candidates: sortByBaseRrf(input.candidates).map((candidate) => ({
          ...candidate,
          rankScore: baseRrfScore(candidate),
        })),
      };
    },
  };
}
