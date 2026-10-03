import * as lifecycleRepo from '../../infrastructure/persistence/wiki-lifecycle-repository.js';
import { calculateWikiRetentionScore } from './wiki-retention.js';

export interface WikiLifecycleRunOptions {
  now?: Date;
  pageLimit?: number;
  claimLimit?: number;
  staleAfterDays?: number;
  archiveAfterDays?: number;
  claimExpiryDays?: number;
}

export interface WikiLifecycleRunResult {
  pagesScanned: number;
  pagesStaled: number;
  pagesArchived: number;
  claimsExpired: number;
}

const ageInDays = (timestamp: string | null, current: Date): number => {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return Math.max(0, (current.getTime() - Date.parse(timestamp)) / 86_400_000);
};

/** 执行一批 Wiki 知识生命周期评估；操作幂等且只做软状态变更。 */
export function runWikiLifecycleOnce(
  options: WikiLifecycleRunOptions = {},
): WikiLifecycleRunResult {
  const current = options.now ?? new Date();
  const staleAfterDays = options.staleAfterDays ?? 180;
  const archiveAfterDays = options.archiveAfterDays ?? 365;
  const claimExpiryDays = options.claimExpiryDays ?? 365;
  const result: WikiLifecycleRunResult = {
    pagesScanned: 0,
    pagesStaled: 0,
    pagesArchived: 0,
    claimsExpired: 0,
  };

  for (const page of lifecycleRepo.listPagesForLifecycle(options.pageLimit ?? 100)) {
    result.pagesScanned++;
    const status = evaluatePage(page, current, staleAfterDays, archiveAfterDays);
    if (status === 'stale') result.pagesStaled++;
    if (status === 'archived') result.pagesArchived++;
  }
  result.claimsExpired = expireClaims(current, claimExpiryDays, options);
  return result;
}

/** Evaluate one page with the existing decay thresholds and audit writes. */
function evaluatePage(
  page: lifecycleRepo.WikiPage,
  current: Date,
  staleAfterDays: number,
  archiveAfterDays: number,
): 'stale' | 'archived' | null {
  const score = calculateWikiRetentionScore({
    ...page,
    lastConfirmedAt: page.lastConfirmedAt ?? page.updatedAt,
    now: current,
  });
  const age = ageInDays(page.lastConfirmedAt ?? page.updatedAt, current);
  if (page.status === 'active' && age >= staleAfterDays && score < 0.25) {
    lifecycleRepo.updatePageStatus(page.id, 'stale');
    lifecycleRepo.recordEvent(
      'page',
      page.id,
      'decayed',
      score,
      page.sourceId,
      page.path,
      'retention score below stale threshold',
    );
    return 'stale';
  } else if (page.status === 'stale' && age >= archiveAfterDays && score < 0.12) {
    lifecycleRepo.updatePageStatus(page.id, 'archived');
    lifecycleRepo.recordEvent(
      'page',
      page.id,
      'archived',
      score,
      page.sourceId,
      page.path,
      'long-term stale page archived',
    );
    return 'archived';
  }
  return null;
}

/** Expire eligible claims with the same per-run limits and confirmation rules. */
function expireClaims(
  current: Date,
  claimExpiryDays: number,
  options: WikiLifecycleRunOptions,
): number {
  let expired = 0;
  for (const claim of lifecycleRepo.listClaimsForLifecycle(options.claimLimit ?? 200)) {
    const age = ageInDays(claim.lastConfirmedAt ?? claim.createdAt, current);
    if (age < claimExpiryDays || claim.status === 'contested') continue;
    lifecycleRepo.expireClaim(claim.id, current.toISOString());
    lifecycleRepo.recordEvent(
      'claim',
      claim.id,
      'expired',
      null,
      null,
      null,
      'claim was not confirmed within retention window',
    );
    expired++;
  }
  return expired;
}
