import { callJev } from '../jev/jevClient.js';
import { toJevConfig } from '../jev/config.js';
import type { JevSettings } from '../../types.js';
import type { JevAnswer } from '../jev/types.js';
import { baseRrfScore, sortByBaseRrf } from './legacyRerankProvider.js';
import type {
  RerankCandidate,
  RerankInput,
  RerankProvider,
  RerankProviderConfig,
  RerankOutcome,
  RerankedCandidate,
} from './types.js';

/** 实验性 Jev rerank 每次最多评分的候选数。 */
export const JEV_RERANK_TOP_K = 8;
const RERANK_STATE_MAX_CHARS = 12_000;

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= RERANK_STATE_MAX_CHARS
    ? trimmed
    : `${trimmed.slice(0, RERANK_STATE_MAX_CHARS)}…`;
}

function buildState(query: string, candidates: readonly RerankCandidate[]): Record<string, string> {
  return {
    query: truncate(query),
    candidates: JSON.stringify(
      candidates.map((candidate, index) => ({
        candidateKey: `candidate_${index}`,
        id: candidate.document.id,
        text: truncate(
          `${candidate.document.title}\n${candidate.document.heading}\n${candidate.document.body}`,
        ),
      })),
    ),
  };
}

function buildQuestion(
  candidate: RerankCandidate,
  index: number,
): {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
} {
  return {
    type: 'noul',
    instructions: `Does the candidate with candidateKey "candidate_${index}" (document id "${candidate.document.id}") in state.candidates directly answer state.query?`,
    criteria: {
      true: 'The candidate contains the information needed to answer the query.',
      false: 'The candidate is only loosely related, off-topic, or lacks the answer.',
    },
  };
}

function readSemanticScore(answer: JevAnswer | undefined): number | undefined {
  if (answer?.type !== 'noul' || !Number.isFinite(answer.noul)) return undefined;
  return Math.min(1, Math.max(0, answer.noul));
}

async function scoreCandidates(
  query: string,
  candidates: readonly RerankCandidate[],
  settings: JevSettings,
): Promise<{ candidates: RerankedCandidate[] } | { reason: string; message: string }> {
  const questions: Record<string, ReturnType<typeof buildQuestion>> = {};
  candidates.forEach((candidate, index) => {
    questions[`candidate_${index}`] = buildQuestion(candidate, index);
  });
  const result = await callJev(
    toJevConfig(settings),
    {
      state: buildState(query, candidates),
      model: settings.model,
      questions,
    },
    { operation: 'wiki_rerank' },
  );
  if (!result.ok) return { reason: result.reason, message: result.message };
  const rankedCandidates: RerankedCandidate[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const semanticScore = readSemanticScore(result.answers[`candidate_${index}`]);
    if (semanticScore === undefined) {
      return {
        reason: 'malformed_response',
        message: `Jev 响应缺少候选 ${candidate.document.id} 的 rerank 相关性判定`,
      };
    }
    rankedCandidates.push({ ...candidate, rankScore: semanticScore * 1000, semanticScore });
  }
  return { candidates: rankedCandidates };
}

/** Jev 语义 rerank provider；任一候选失败即交给 policy 回退 legacy。 */
export function createJevRerankProvider(): RerankProvider {
  return {
    id: 'jev',
    async rerank(input: RerankInput, config: RerankProviderConfig): Promise<RerankOutcome> {
      const ordered = sortByBaseRrf(input.candidates);
      const selected = ordered.slice(0, JEV_RERANK_TOP_K);
      const scored = await scoreCandidates(input.query, selected, config.jev);
      if ('reason' in scored) {
        return { kind: 'unavailable', providerId: 'jev', ...scored };
      }
      const reranked = scored.candidates.sort(
        (left, right) => (right.semanticScore ?? 0) - (left.semanticScore ?? 0),
      );
      const selectedIds = new Set(selected.map((candidate) => candidate.document.id));
      const remainder = ordered
        .filter((candidate) => !selectedIds.has(candidate.document.id))
        .map((candidate) => ({ ...candidate, rankScore: baseRrfScore(candidate) }));
      return { kind: 'ranked', providerId: 'jev', candidates: [...reranked, ...remainder] };
    },
  };
}
