export interface WikiRetentionInput {
  confidence: number;
  importance: number;
  accessCount: number;
  lastConfirmedAt?: string | null;
  now?: Date;
  halfLifeDays?: number;
}

/** 计算 Wiki 知识的生命周期分；只影响检索优先级，不判定事实真假。 */
export function calculateWikiRetentionScore(input: WikiRetentionInput): number {
  const confidence = Math.max(0, Math.min(1, input.confidence));
  const importance = Math.max(0, Math.min(1, input.importance));
  const accessCount = Math.max(0, input.accessCount);
  const halfLifeDays = Math.max(1, input.halfLifeDays ?? 180);
  const current = input.now ?? new Date();
  const confirmedAt = input.lastConfirmedAt ? Date.parse(input.lastConfirmedAt) : current.getTime();
  const ageDays = Math.max(0, (current.getTime() - confirmedAt) / 86_400_000);
  const freshness = Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
  const accessBoost = Math.min(0.2, Math.log1p(accessCount) * 0.03);
  return Math.max(0, Math.min(1.2, confidence * importance * freshness + accessBoost));
}
