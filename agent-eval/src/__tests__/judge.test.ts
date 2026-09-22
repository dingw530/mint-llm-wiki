import { describe, expect, it, vi } from 'vitest';
vi.mock('mint-server/eval', () => ({ callJev: vi.fn() }));
import { callJev } from 'mint-server/eval';
import { buildCalibrationTemplate, compareCalibration } from '../calibration.js';
import {
  assessJudgeResult,
  runEvaluation,
  validateCase,
  type EvalCase,
  type EvalJudgeResult,
} from '../index.js';
import {
  buildJudgePrompt,
  createJevJudge,
  createOpenAiJudge,
  parseJudgeResponse,
} from '../judge.js';

const judgeCase: EvalCase = {
  id: 'judge-001',
  input: '根据资料说明 RAG 的价值。',
  tags: ['wiki', 'citation'],
  expected: {
    mustContain: ['检索'],
    requiredSourceFiles: ['rag.md'],
    minCitations: 1,
    rubric: { essential: [{ type: 'answer_contains', value: '检索' }] },
    judgeRubric: {
      version: 'test-v1',
      pitfalls: ['只堆砌关键词'],
      edgeCases: ['资料不足时应拒答'],
      dimensions: [
        {
          id: 'correctness',
          name: '正确性',
          importance: 'essential',
          gate: 'answer',
          scoring: { '1': '错误', '2': '部分正确', '3': '正确', '4': '准确完整' },
        },
        {
          id: 'completeness',
          name: '完整性',
          importance: 'important',
          gate: 'answer',
          scoring: { '1': '遗漏核心', '2': '遗漏部分', '3': '覆盖核心', '4': '覆盖全部' },
        },
        {
          id: 'style',
          name: '简洁性',
          importance: 'optional',
          gate: 'both',
          scoring: { '1': '冗长', '2': '偏长', '3': '简洁', '4': '精炼' },
        },
        {
          id: 'hallucination',
          name: '幻觉',
          importance: 'veto',
          gate: 'both',
          veto: { pass: '均有证据', fail: '编造事实' },
        },
      ],
    },
  },
};

const approvedJudge: EvalJudgeResult = {
  dimensions: [
    { id: 'correctness', score: 4, evidenceIds: ['C1'], reason: '结论与来源一致。' },
    { id: 'completeness', score: 3, evidenceIds: ['C1'], reason: '覆盖核心结论。' },
    { id: 'style', score: 3, evidenceIds: [], reason: '表达简洁。' },
    { id: 'hallucination', passed: true, evidenceIds: ['C1'], reason: '没有编造事实。' },
  ],
  confidence: 0.9,
  shortReason: '回答正确且有证据。',
};

describe('LLM Judge evaluation', () => {
  it('maps Jev typed answers into the existing Judge result contract', async () => {
    vi.mocked(callJev).mockResolvedValue({
      ok: true,
      latencyMs: 1,
      answers: {
        correctness: { type: 'score', score: 4, legend: [], confidence: 0.9 },
        completeness: { type: 'score', score: 3, legend: [], confidence: 0.8 },
        style: { type: 'score', score: 4, legend: [], confidence: 0.8 },
        hallucination: { type: 'noul', noul: 0.1 },
      },
    });
    const report = await runEvaluation(
      { name: 'judge', version: '1', cases: [judgeCase] },
      async () => ({
        content: 'RAG 先检索资料，再用检索结果生成回答。',
        events: [{ type: 'run_completed' }],
        citations: [{ file: 'rag.md', refId: 'C1' }],
      }),
      1,
      createJevJudge({
        apiUrl: 'https://jev.example',
        apiKey: 'key',
        modelId: 'jev-model',
        timeoutMs: 1000,
      }),
    );
    expect(report.results[0]?.judgePassed).toBe(true);
    expect(report.results[0]?.judge?.dimensions).toHaveLength(4);
    expect(report.results[0]?.judge?.dimensions[0]?.evidenceIds).toContain('C1');
    expect(report.results[0]?.judge?.shortReason).toContain('全部维度通过');
  });

  it('validates a self-contained judge rubric and rejects incomplete scoring levels', () => {
    expect(() => validateCase(judgeCase)).not.toThrow();
    const invalid = {
      ...judgeCase,
      id: 'judge-invalid',
      expected: {
        ...judgeCase.expected,
        judgeRubric: {
          ...judgeCase.expected.judgeRubric!,
          dimensions: [
            {
              id: 'broken',
              name: '损坏',
              importance: 'essential',
              scoring: { '1': '一分', '2': '二分', '3': '三分' },
            },
          ],
        },
      },
    };
    expect(() => validateCase(invalid)).toThrow('Invalid judge scoring');
  });

  it('scores judge dimensions after deterministic validation and exposes judge metrics', async () => {
    const report = await runEvaluation(
      { name: 'judge', version: '1', cases: [judgeCase] },
      async () => ({
        content: 'RAG 先检索资料，再用检索结果生成回答。',
        events: [{ type: 'run_completed' }],
        citations: [{ file: 'rag.md', refId: 'C1' }],
      }),
      1,
      async (input) => {
        expect(input.execution.events[0]?.result).toBeUndefined();
        expect(input.deterministic.passed).toBe(true);
        return approvedJudge;
      },
    );
    expect(report.results[0]?.judgePassed).toBe(true);
    expect(report.results[0]?.judge?.answerGatePassed).toBe(true);
    expect(report.results[0]?.judge?.evidenceGatePassed).toBe(true);
    expect(report.results[0]?.answerGate?.passed).toBe(true);
    expect(report.results[0]?.evidenceGate?.passed).toBe(true);
    expect(report.results[0]?.answerPassed).toBe(true);
    expect(report.results[0]?.queryPassed).toBe(true);
    expect(report.results[0]?.passed).toBe(true);
    expect(report.results[0]?.qualityPassed).toBe(true);
    expect(report.results[0]?.judge?.weightedScore).toBeCloseTo(0.875);
    expect(report.summary.judgePassAt1).toBe(1);
    expect(report.summary.averageAnswerChars).toBeGreaterThan(0);
  });

  it('skips judge calls when deterministic hard gates fail', async () => {
    let called = false;
    const report = await runEvaluation(
      { name: 'judge', version: '1', cases: [judgeCase] },
      async () => ({ content: '没有引用的检索回答。', events: [{ type: 'run_completed' }] }),
      1,
      async () => {
        called = true;
        return approvedJudge;
      },
    );
    expect(called).toBe(false);
    expect(report.results[0]?.judge?.skipped).toBe(true);
    expect(report.results[0]?.judgePassed).toBe(false);
  });

  it('sends keyword-only answer failures to Judge instead of treating them as final quality failures', async () => {
    let called = false;
    const report = await runEvaluation(
      { name: 'judge', version: '1', cases: [judgeCase] },
      async () => ({
        content: '资料支持 RAG 可以降低回答风险。',
        events: [{ type: 'run_completed' }],
        citations: [{ file: 'rag.md', refId: 'C1' }],
      }),
      1,
      async (input) => {
        called = true;
        expect(input.deterministic.answerPassed).toBe(true);
        expect(input.deterministic.answerGate?.hardPassed).toBe(true);
        return approvedJudge;
      },
    );
    expect(called).toBe(true);
    expect(report.results[0]?.qualityPassed).toBe(true);
    expect(report.results[0]?.passed).toBe(true);
    expect(report.results[0]?.queryPassed).toBe(true);
    expect(report.results[0]?.answerGate?.signalPassed).toBe(true);
    expect(report.results[0]?.answerGate?.judgePassed).toBe(true);
  });

  it('rejects missing judge dimensions and veto failures', () => {
    const rubric = judgeCase.expected.judgeRubric!;
    expect(() =>
      assessJudgeResult(rubric, {
        ...approvedJudge,
        dimensions: approvedJudge.dimensions.slice(0, 3),
      }),
    ).toThrow('dimensions do not match');
    const vetoed = assessJudgeResult(rubric, {
      ...approvedJudge,
      dimensions: approvedJudge.dimensions.map((dimension) =>
        dimension.id === 'hallucination' ? { ...dimension, passed: false } : dimension,
      ),
    });
    expect(vetoed.passed).toBe(false);
  });

  it.each(['无', '无。', 'none', 'No critical failure.'])(
    'treats %s as no critical failure',
    (criticalFailure) => {
      const assessed = assessJudgeResult(judgeCase.expected.judgeRubric!, {
        ...approvedJudge,
        criticalFailure,
      });
      expect(assessed.criticalFailure).toBeUndefined();
      expect(assessed.answerGatePassed).toBe(true);
      expect(assessed.evidenceGatePassed).toBe(true);
      expect(assessed.passed).toBe(true);
    },
  );

  it('preserves a substantive critical failure', () => {
    const assessed = assessJudgeResult(judgeCase.expected.judgeRubric!, {
      ...approvedJudge,
      criticalFailure: '引用了不存在的来源。',
    });
    expect(assessed.criticalFailure).toBe('引用了不存在的来源。');
    expect(assessed.passed).toBe(false);
  });

  it('exports and compares human calibration labels', async () => {
    const report = await runEvaluation(
      { name: 'judge', version: '1', cases: [judgeCase] },
      async () => ({
        content: 'RAG 通过检索资料降低回答风险。',
        events: [{ type: 'run_completed' }],
        citations: [{ file: 'rag.md', refId: 'C1' }],
      }),
      1,
      async () => approvedJudge,
    );
    const template = buildCalibrationTemplate(report);
    template.labels[0]!.passed = true;
    template.labels[0]!.answerGatePassed = true;
    template.labels[0]!.evidenceGatePassed = true;
    template.labels[0]!.dimensions = approvedJudge.dimensions;
    const comparison = compareCalibration(report, template.labels);
    expect(comparison.matched).toBe(1);
    expect(comparison.passAgreementRate).toBe(1);
    expect(comparison.answerGateAgreementRate).toBe(1);
    expect(comparison.evidenceGateAgreementRate).toBe(1);
    expect(comparison.calibrated).toBe(false);
    expect(comparison.dimensionExactAgreementRate).toBe(1);
  });

  it('builds and validates an OpenAI-compatible structured judge response', () => {
    const prompt = buildJudgePrompt({
      evalCase: judgeCase,
      execution: { content: '回答', events: [], citations: [], retrievedCitations: [] },
      deterministic: {
        caseId: 'judge-001',
        runIndex: 1,
        passed: true,
        queryPassed: true,
        answerPassed: true,
        retrievalPassed: true,
        toolBudgetPassed: true,
        abstentionPassed: true,
        vetoed: false,
        reasons: [],
        content: '回答',
        citations: [],
        citationCount: 0,
        retrievedCitationCount: 0,
        citationCoverage: 0,
        retrievalCoverage: 0,
        abstained: false,
        rounds: 0,
        toolCalls: 0,
        attemptedToolCalls: 0,
        blockedToolCalls: 0,
        wikiSearchCalls: 0,
        attemptedWikiSearchCalls: 0,
        blockedWikiSearchCalls: 0,
        unrelatedToolCalls: 0,
        successfulToolCalls: 0,
        retries: 0,
        loopDetected: false,
        approvalRequired: false,
        latencyMs: 1,
      },
    });
    expect(prompt).toContain('不要因为答案更长');
    const parsed = parseJudgeResponse(
      { choices: [{ message: { content: JSON.stringify(approvedJudge) } }] },
      { apiUrl: 'https://example.test', apiKey: 'key', modelId: 'judge-model' },
    );
    expect(parsed.judgeModel).toBe('judge-model');
  });

  it('normalizes common compatible schema aliases without relaxing validation', () => {
    const parsed = parseJudgeResponse(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...approvedJudge,
                dimensions: undefined,
                scores: approvedJudge.dimensions,
                confidence: '0.8',
                summary: '兼容响应',
                shortReason: undefined,
              }),
            },
          },
        ],
      },
      { apiUrl: 'https://example.test', apiKey: 'key', modelId: 'judge-model' },
    );
    expect(parsed).toMatchObject({
      confidence: 0.8,
      shortReason: '兼容响应',
      judgeModel: 'judge-model',
    });
    expect(parsed.dimensions).toHaveLength(4);
  });

  it('retries when an OpenAI-compatible provider returns an empty assistant message', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        const body =
          calls === 1
            ? {
                choices: [
                  {
                    message: { content: null, reasoning_content: 'not an answer payload' },
                    finish_reason: 'stop',
                  },
                ],
              }
            : {
                choices: [
                  { message: { content: JSON.stringify(approvedJudge) }, finish_reason: 'stop' },
                ],
              };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    try {
      const report = await runEvaluation(
        { name: 'judge', version: '1', cases: [judgeCase] },
        async () => ({
          content: 'RAG 先检索资料，再用检索结果生成回答。',
          events: [{ type: 'run_completed' }],
          citations: [{ file: 'rag.md', refId: 'C1' }],
        }),
        1,
        createOpenAiJudge({
          apiUrl: 'https://example.test',
          apiKey: 'key',
          modelId: 'judge-model',
        }),
      );
      expect(calls).toBe(2);
      expect(report.results[0]?.judgePassed).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
