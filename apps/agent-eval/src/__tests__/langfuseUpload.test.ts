import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEvalReport, uploadEvalReport } from '../langfuseUpload.js';
import type { EvalReport } from '../index.js';

const report: EvalReport = {
  dataset: 'wiki-rag',
  version: '1.2.0',
  resultVersion: 'wiki-rag-test-version',
  runsPerCase: 1,
  generatedAt: '2026-08-28T00:00:00.000Z',
  summary: {
    totalRuns: 1, passedRuns: 1, queryPassedRuns: 1, answerPassedRuns: 1, passAt1: 1, queryPassAt1: 1, answerPassAt1: 1,
    passAtK: 1, passAtKValue: 1, passPowerK: 1, passPowerKValue: 1, toolSuccessRate: 1, toolBudgetPassRate: 1,
    wikiSearchBudgetPassRate: 1, averageRounds: 1, averageToolCalls: 1, averageAttemptedToolCalls: 1, averageBlockedToolCalls: 0,
    averageWikiSearchCalls: 1, averageAttemptedWikiSearchCalls: 1, averageBlockedWikiSearchCalls: 0, unrelatedToolRate: 0,
    retryRate: 0, loopRate: 0, averageLatencyMs: 1, p50LatencyMs: 1, p95LatencyMs: 1, averageInputTokens: 0,
    averageOutputTokens: 0, averageReasoningTokens: 0, averageTtftMs: 0, citationCoverageRate: 1, citationAccuracyRate: 1,
    citationGroundingRate: 1, retrievalCoverageRate: 1, abstentionAccuracy: 1, essentialPassRate: 1, importantPassRate: 1,
    optionalPassRate: 1, judgeRuns: 1, judgePassAt1: 1, averageJudgeScore: 1, averageJudgeConfidence: 1,
    judgeCriticalFailureRate: 0, averageAnswerChars: 20,
  },
  caseStats: [],
  results: [{
    caseId: 'security-001', runIndex: 1, passed: true, queryPassed: true, answerPassed: true, retrievalPassed: true,
    toolBudgetPassed: true, abstentionPassed: true, vetoed: false, reasons: [], content: '不要上传的答案', citations: [],
    citationCount: 0, retrievedCitationCount: 0, citationCoverage: 0, retrievalCoverage: 0, citationGroundingPassed: true,
    abstained: false, rounds: 1, toolCalls: 1, attemptedToolCalls: 1, blockedToolCalls: 0, wikiSearchCalls: 0,
    attemptedWikiSearchCalls: 0, blockedWikiSearchCalls: 0, unrelatedToolCalls: 0, successfulToolCalls: 1, retries: 0,
    loopDetected: false, approvalRequired: false, latencyMs: 10, answerChars: 20,
  }],
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('Langfuse eval upload', () => {
  it('uploads summary and case scores without answer content', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 200 });
    }));

    const result = await uploadEvalReport(report, { baseUrl: 'https://langfuse.example', publicKey: 'public', secretKey: 'secret' });

    expect(result).toEqual({ reportVersion: 'wiki-rag-test-version', scoreCount: 29 });
    expect(requests).toHaveLength(29);
    expect(requests.every((request) => request.url === 'https://langfuse.example/api/public/ingestion')).toBe(true);
    expect(requests.every((request) => !JSON.stringify(request.body).includes('不要上传的答案'))).toBe(true);
    expect(requests.every((request) => {
      const event = (request.body.batch as Array<Record<string, unknown>>)[0];
      return typeof event.id === 'string'
        && event.timestamp === '2026-08-28T00:00:00.000Z'
        && event.type === 'score-create'
        && (event.body as Record<string, unknown>).sessionId === 'eval-wiki-rag-test-version';
    })).toBe(true);
  });

  it('rejects invalid report files', async () => {
    await expect(readEvalReport('/tmp/does-not-exist-eval-report.json')).rejects.toThrow();
  });
});
