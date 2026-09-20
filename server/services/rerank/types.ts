import type { JevSettings } from '../../types.js';
import type { WikiSearchDocumentInput } from '../../repositories/wikiSearchRepository.js';

/** 一个已经由关键词或向量检索召回的 Wiki 候选。 */
export interface RerankCandidate {
  document: WikiSearchDocumentInput;
  lexicalRank: number | null;
  vectorRank: number | null;
  vectorDistance: number | null;
}

/** provider 返回的带排序分候选；原始检索 rank 始终保留供证据展示。 */
export interface RerankedCandidate extends RerankCandidate {
  rankScore: number;
  semanticScore?: number;
}

/** rerank provider 的输入。候选已经由代码完成召回与安全过滤。 */
export interface RerankInput {
  query: string;
  candidates: readonly RerankCandidate[];
}

/** rerank provider 的配置边界。 */
export interface RerankProviderConfig {
  jev: JevSettings;
}

/** provider 的正常结果或可降级失败。 */
export type RerankOutcome =
  | { kind: 'ranked'; providerId: string; candidates: RerankedCandidate[] }
  | { kind: 'unavailable'; providerId: string; reason: string; message: string };

/** Wiki rerank 的可替换实现。 */
export interface RerankProvider {
  readonly id: string;
  rerank(input: RerankInput, config: RerankProviderConfig): Promise<RerankOutcome>;
}
