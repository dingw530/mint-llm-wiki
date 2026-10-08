export const JUDGE_SYSTEM_PROMPT = '你是一名严格的评测裁判。只能返回符合约定格式的有效 JSON。';

export const PAIRWISE_JUDGE_SYSTEM_PROMPT = '你是一名严格的成对比较评测裁判。只能返回包含 winner（a、b 或 tie）、confidence（0 到 1）和简短证据结论的 JSON。不要因为答案更长或文风更好而加分。';

export const JUDGE_EVALUATION_TASK = [
  '只能依据提供的可观察证据评估 Agent 结果。',
  '不要因为答案更长、文风更好、重复关键词或提出无证据的主张而加分。',
  '不要推断隐藏的思考过程。',
  '将 expected.mustContain 和 expected.mustContainAny 视为词法信号，而不是必须使用的原词。',
  '除非 Rubric 明确要求精确术语、标识符、数字或安全动作，否则应接受清晰的语义等价表达。',
  '如果答案已经覆盖底层概念，不要仅因为缺少某个词法信号就报告严重失败。',
].join(' ');

/** 构造 Judge 返回格式错误时的纠正提示。 */
export function buildJudgeCorrectionPrompt(contract: unknown, previous: string): string {
  return `你上一次返回的 JSON 不符合约定格式。只能返回修正后的 JSON 对象；保留原有评估结论，不要增加字段。以下是约定格式和上一次输出：\n${JSON.stringify({ contract, previous })}`;
}
