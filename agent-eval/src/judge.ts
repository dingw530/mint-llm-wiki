import {
  getJudgeDimensionGate,
  type EvalJudgeInput,
  type EvalJudgeResult,
  type JudgeExecutor,
} from './index.js';
import type { PairwiseJudgeExecutor, PairwiseJudgment } from './pairwise.js';
import {
  buildJudgeCorrectionPrompt,
  JUDGE_EVALUATION_TASK,
  JUDGE_SYSTEM_PROMPT,
  PAIRWISE_JUDGE_SYSTEM_PROMPT,
} from './judgePrompts.js';
import type { JevAnswer, JevConfig, JevQuestion } from 'mint-server/eval';
import { callJev } from 'mint-server/eval';

export interface OpenAiJudgeConfig {
  apiUrl: string;
  apiKey: string;
  modelId: string;
}

export interface JevJudgeConfig {
  apiUrl: string;
  apiKey: string;
  modelId: string;
  timeoutMs: number;
}

export type JudgeProvider = 'llm' | 'jev';

function clampScore(value: number): number {
  return Math.min(4, Math.max(1, Math.round(value)));
}

function answerConfidence(answer: JevAnswer): number {
  if (answer.type === 'noul') return Math.abs(answer.noul * 2 - 1);
  return answer.confidence;
}

function answerScore(answer: JevAnswer): number {
  if (answer.type === 'score') return clampScore(answer.score);
  if (answer.type === 'noul') return clampScore(answer.noul * 4);
  const passed = answer.choice === 'pass' || answer.choice === 'true';
  return passed ? 4 : 1;
}

function evidenceIds(input: EvalJudgeInput): string[] {
  const values = [
    ...(input.execution.citations || []),
    ...(input.execution.retrievedCitations || []),
  ]
    .flatMap((citation) => [citation.refId, citation.chunkId, citation.file])
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

function buildJevState(input: EvalJudgeInput): Record<string, string> {
  return {
    question: input.evalCase.input,
    answer: input.execution.content,
    answer_citations: JSON.stringify(input.execution.citations || []),
    retrieved_citations: JSON.stringify(input.execution.retrievedCitations || []),
    observable_trace: JSON.stringify(input.execution.events),
    deterministic_result: JSON.stringify({
      passed: input.deterministic.passed,
      reasons: input.deterministic.reasons,
      citationCoverage: input.deterministic.citationCoverage,
      retrievalCoverage: input.deterministic.retrievalCoverage,
    }),
  };
}

function buildJevQuestions(input: EvalJudgeInput): Record<string, JevQuestion> {
  const rubric = input.evalCase.expected.judgeRubric!;
  return Object.fromEntries(
    rubric.dimensions.map((dimension) => {
      if (dimension.importance === 'veto') {
        return [
          dimension.id,
          {
            type: 'noul',
            instructions: `Does the answer violate the veto dimension "${dimension.name}"?`,
            criteria: {
              true: dimension.veto?.fail || 'The answer violates this veto.',
              false: dimension.veto?.pass || 'The answer does not violate this veto.',
            },
          } satisfies JevQuestion,
        ];
      }
      const scoring = dimension.scoring || {
        '1': 'Fails the dimension or provides no support.',
        '2': 'Partially meets the dimension with material omissions.',
        '3': 'Mostly meets the dimension with minor omissions.',
        '4': 'Fully meets the dimension with clear support.',
      };
      return [
        dimension.id,
        {
          type: 'score',
          instructions: `Score the answer for the ${dimension.name} dimension using only the supplied answer and evidence.`,
          criteria: ['1', '2', '3', '4'].map(
            (level) => `${level}: ${scoring[level as '1' | '2' | '3' | '4']}`,
          ),
        } satisfies JevQuestion,
      ];
    }),
  );
}

function jevFailureReason(dimension: string, answer: JevAnswer): string {
  if (answer.type === 'noul') return `${dimension}：Jev 判定概率 ${answer.noul.toFixed(2)}。`;
  if (answer.type === 'score') return `${dimension}：Jev 评分 ${answer.score.toFixed(2)}。`;
  return `${dimension}：Jev 选择 ${answer.choice}。`;
}

/** 创建基于 Jev typed questions 的 Judge；解释和证据 ID 由本地代码生成。 */
export function createJevJudge(config: JevJudgeConfig): JudgeExecutor {
  if (!config.apiUrl || !config.apiKey || !config.modelId)
    throw new Error('Jev Judge requires apiUrl, apiKey and modelId');
  return async (input) => {
    const rubric = input.evalCase.expected.judgeRubric!;
    const result = await callJev(
      {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.modelId,
        timeoutMs: config.timeoutMs,
      } satisfies JevConfig,
      { state: buildJevState(input), model: config.modelId, questions: buildJevQuestions(input) },
      { operation: 'agent_eval_judge' },
    );
    if (!result.ok) throw new Error(`Jev Judge failed: ${result.reason} ${result.message}`);
    const ids = evidenceIds(input);
    const dimensions = rubric.dimensions.map((dimension) => {
      const answer = result.answers[dimension.id];
      if (!answer) throw new Error(`Jev Judge missing dimension: ${dimension.id}`);
      if (dimension.importance === 'veto') {
        const passed = answer.type === 'noul' ? answer.noul < 0.5 : false;
        return {
          id: dimension.id,
          passed,
          evidenceIds: ids,
          reason: jevFailureReason(dimension.name, answer),
        };
      }
      return {
        id: dimension.id,
        score: answerScore(answer),
        evidenceIds: ids,
        reason: jevFailureReason(dimension.name, answer),
      };
    });
    const failed = dimensions.filter(
      (dimension) =>
        dimension.passed === false || (dimension.score !== undefined && dimension.score < 3),
    );
    const confidenceValues = rubric.dimensions.map((dimension) =>
      answerConfidence(result.answers[dimension.id]!),
    );
    const confidence =
      confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
    return {
      dimensions,
      confidence,
      shortReason: failed.length
        ? `Jev 未通过维度：${failed.map((dimension) => dimension.id).join('、')}。`
        : 'Jev 判定全部维度通过。',
      criticalFailure: dimensions.find((dimension) => dimension.passed === false)?.reason,
      judgeModel: config.modelId,
    };
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: unknown; refusal?: unknown };
    text?: unknown;
    finish_reason?: unknown;
  }>;
  output_text?: unknown;
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const candidate = (part as { text?: unknown }).text;
      return typeof candidate === 'string' ? candidate : '';
    })
    .join('');
  return text.trim() ? text : undefined;
}

function extractJudgeContent(payload: unknown): string | undefined {
  const response = payload as ChatCompletionResponse;
  const choice = response.choices?.[0];
  return (
    textFromContent(choice?.message?.content) ||
    textFromContent(choice?.text) ||
    textFromContent(response.output_text)
  );
}

function responseShape(payload: unknown): string {
  const response = payload as ChatCompletionResponse;
  const choice = response.choices?.[0];
  const message = choice?.message;
  return JSON.stringify({
    topLevelKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
    choiceKeys: choice ? Object.keys(choice) : [],
    messageKeys: message ? Object.keys(message) : [],
    finishReason: choice?.finish_reason,
    refusal: message?.refusal,
  });
}

function completionUrl(apiUrl: string): string {
  const normalized = apiUrl.replace(/\/$/, '');
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
}

/** 将 Judge 输入转为不含隐藏推理和原始工具载荷的评审请求。 */
export function buildJudgePrompt(input: EvalJudgeInput): string {
  const rubric = input.evalCase.expected.judgeRubric;
  if (!rubric) throw new Error(`Case ${input.evalCase.id} has no judge rubric`);
  return JSON.stringify({
    task: JUDGE_EVALUATION_TASK,
    outputContract: {
      dimensions: rubric.dimensions.map((dimension) => ({
        id: dimension.id,
        gate: getJudgeDimensionGate(dimension),
        importance: dimension.importance,
        score: dimension.importance === 'veto' ? '省略并设置 passed 布尔值' : '整数 1 到 4',
        passed: dimension.importance === 'veto' ? '布尔值' : '省略',
        evidenceIds: '字符串数组；有可用证据时使用 citation 的 refId、chunkId 或 file',
        reason: '简短且基于证据的解释',
      })),
      criticalFailure: '可选字符串',
      confidence: '0 到 1 之间的数字',
      shortReason: '简短字符串',
    },
    input: {
      question: input.evalCase.input,
      expected: input.evalCase.expected,
      judgeRubric: rubric,
      finalAnswer: input.execution.content,
      answerCitations: input.execution.citations || [],
      retrievedCitations: input.execution.retrievedCitations || [],
      observableTrace: input.execution.events,
      finalState: input.execution.state || {},
      deterministicResult: {
        passed: input.deterministic.passed,
        reasons: input.deterministic.reasons,
        citationCoverage: input.deterministic.citationCoverage,
        retrievalCoverage: input.deterministic.retrievalCoverage,
      },
    },
  });
}

/** 解析 OpenAI 兼容 Chat Completions 中的结构化 Judge 结果。 */
export function parseJudgeResponse(payload: unknown, config: OpenAiJudgeConfig): EvalJudgeResult {
  const content = extractJudgeContent(payload);
  if (!content) throw new Error('Judge response does not contain message content');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Judge response is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Judge response must be an object');
  const candidate = parsed as Partial<EvalJudgeResult> & {
    scores?: unknown;
    summary?: unknown;
    reason?: unknown;
  };
  const dimensions = Array.isArray(candidate.dimensions) ? candidate.dimensions : candidate.scores;
  const confidence =
    typeof candidate.confidence === 'number' ? candidate.confidence : Number(candidate.confidence);
  const shortReason =
    typeof candidate.shortReason === 'string'
      ? candidate.shortReason
      : typeof candidate.summary === 'string'
        ? candidate.summary
        : candidate.reason;
  if (
    !Array.isArray(dimensions) ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    typeof shortReason !== 'string' ||
    !shortReason
  ) {
    throw new Error('Judge response does not match the required schema');
  }
  return { ...candidate, dimensions, confidence, shortReason, judgeModel: config.modelId };
}

async function requestJudge(
  config: OpenAiJudgeConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<unknown> {
  const response = await fetch(completionUrl(config.apiUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.modelId,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    }),
  });
  if (!response.ok)
    throw new Error(`Judge request failed: ${response.status} ${await response.text()}`);
  return response.json();
}

/** 创建显式调用 OpenAI 兼容 JSON Judge 的执行器。 */
export function createOpenAiJudge(config: OpenAiJudgeConfig): JudgeExecutor {
  if (!config.apiUrl || !config.apiKey || !config.modelId)
    throw new Error('Judge requires apiUrl, apiKey and modelId');
  return async (input) => {
    const prompt = buildJudgePrompt(input);
    const messages = [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];
    let payload = await requestJudge(config, messages);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return parseJudgeResponse(payload, config);
      } catch (error) {
        lastError = error;
        const previous =
          extractJudgeContent(payload)?.slice(0, 12000) ||
          `未返回可用的助手内容。响应结构：${responseShape(payload)}`;
        const correction = buildJudgeCorrectionPrompt(JSON.parse(prompt).outputContract, previous);
        payload = await requestJudge(config, [...messages, { role: 'user', content: correction }]);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Judge response could not be parsed');
  };
}

/** 创建只比较可观察答案和证据的 OpenAI 兼容配对 Judge。 */
export function createOpenAiPairwiseJudge(config: OpenAiJudgeConfig): PairwiseJudgeExecutor {
  if (!config.apiUrl || !config.apiKey || !config.modelId)
    throw new Error('Judge requires apiUrl, apiKey and modelId');
  return async (input) => {
    const response = await fetch(completionUrl(config.apiUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelId,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PAIRWISE_JUDGE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              question: input.evalCase.input,
              rubric: input.evalCase.expected.judgeRubric,
              candidateA: {
                answer: input.first.content,
                citations: input.first.citations,
                trace: input.first.reasons,
              },
              candidateB: {
                answer: input.second.content,
                citations: input.second.citations,
                trace: input.second.reasons,
              },
            }),
          },
        ],
      }),
    });
    if (!response.ok)
      throw new Error(`Pairwise judge request failed: ${response.status} ${await response.text()}`);
    const content = extractJudgeContent(await response.json());
    if (!content) throw new Error('Pairwise judge response does not contain message content');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Pairwise judge response is not valid JSON');
    }
    const candidate = parsed as Partial<PairwiseJudgment>;
    if (
      !candidate ||
      !['a', 'b', 'tie'].includes(String(candidate.winner)) ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence! < 0 ||
      candidate.confidence! > 1 ||
      typeof candidate.reason !== 'string' ||
      !candidate.reason
    ) {
      throw new Error('Pairwise judge response does not match the required schema');
    }
    return {
      winner: candidate.winner!,
      confidence: candidate.confidence!,
      reason: candidate.reason,
    };
  };
}
