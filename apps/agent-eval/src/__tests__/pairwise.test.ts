import { describe, expect, it } from 'vitest';
import { calculateElo, runPairwiseComparison } from '../pairwise.js';
import type { EvalCase, EvalCaseResult, EvalDataset, EvalReport } from '../index.js';

const evalCase: EvalCase = { id: 'pair-001', input: '问题', tags: ['qa'], expected: {} };
const dataset: EvalDataset = { name: 'pair', version: '1', cases: [evalCase] };

function result(passed: boolean, content: string): EvalCaseResult {
  return { caseId: 'pair-001', runIndex: 1, passed, queryPassed: passed, answerPassed: passed, retrievalPassed: passed, toolBudgetPassed: passed, abstentionPassed: passed, vetoed: false, reasons: [], content, citations: [], citationCount: 0, retrievedCitationCount: 0, citationCoverage: 0, retrievalCoverage: 0, abstained: false, rounds: 1, toolCalls: 0, attemptedToolCalls: 0, blockedToolCalls: 0, wikiSearchCalls: 0, attemptedWikiSearchCalls: 0, blockedWikiSearchCalls: 0, unrelatedToolCalls: 0, successfulToolCalls: 0, retries: 0, loopDetected: false, approvalRequired: false, latencyMs: 1 };
}

function report(resultItem: EvalCaseResult): EvalReport {
  return { dataset: 'pair', version: '1', runsPerCase: 1, generatedAt: '2026-08-24T00:00:00.000Z', summary: { totalRuns: 1, passedRuns: 1, queryPassedRuns: 1, answerPassedRuns: 1, passAt1: 1, queryPassAt1: 1, answerPassAt1: 1, passAtK: 1, passAtKValue: 1, passPowerK: 1, passPowerKValue: 1, toolSuccessRate: 0, toolBudgetPassRate: 1, wikiSearchBudgetPassRate: 1, averageRounds: 1, averageToolCalls: 0, averageAttemptedToolCalls: 0, averageBlockedToolCalls: 0, averageWikiSearchCalls: 0, averageAttemptedWikiSearchCalls: 0, averageBlockedWikiSearchCalls: 0, unrelatedToolRate: 0, retryRate: 0, loopRate: 0, averageLatencyMs: 1, p50LatencyMs: 1, p95LatencyMs: 1, averageInputTokens: 0, averageOutputTokens: 0, averageReasoningTokens: 0, averageTtftMs: 0, citationCoverageRate: 0, citationAccuracyRate: 0, retrievalCoverageRate: 0, abstentionAccuracy: 0, essentialPassRate: 0, importantPassRate: 0, optionalPassRate: 0, judgeRuns: 0, judgePassAt1: 0, averageJudgeScore: 0, averageJudgeConfidence: 0, judgeCriticalFailureRate: 0, averageAnswerChars: resultItem.content.length }, caseStats: [], results: [resultItem] };
}

describe('pairwise evaluation', () => {
  it('uses a forced deterministic winner without calling the semantic judge', async () => {
    let calls = 0;
    const comparison = await runPairwiseComparison(dataset, report(result(true, '正确')), report(result(false, '错误')), 'A', 'B', async () => { calls += 1; return { winner: 'a', confidence: 1, reason: 'unused' }; });
    expect(calls).toBe(0);
    expect(comparison.winsA).toBe(1);
    expect(calculateElo(comparison).A).toBeGreaterThan(1000);
  });

  it('accepts a winner only when position-swapped judgments agree', async () => {
    const comparison = await runPairwiseComparison(dataset, report(result(true, '答案 A')), report(result(true, '答案 B')), 'A', 'B', async input => input.first.content === '答案 A' ? { winner: 'a', confidence: 0.8, reason: 'A 更完整' } : { winner: 'b', confidence: 0.8, reason: 'A 更完整' });
    expect(comparison.winsA).toBe(1);
    expect(comparison.positionDisagreements).toBe(0);
  });

  it('records a tie when position-swapped judgments conflict', async () => {
    const comparison = await runPairwiseComparison(dataset, report(result(true, '答案 A')), report(result(true, '答案 B')), 'A', 'B', async () => ({ winner: 'a', confidence: 0.7, reason: 'position bias' }));
    expect(comparison.ties).toBe(1);
    expect(comparison.positionDisagreements).toBe(1);
  });
});
