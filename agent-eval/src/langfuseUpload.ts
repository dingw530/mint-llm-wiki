import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { EvalReport } from './index.js';

export interface LangfuseUploadConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

export interface LangfuseUploadResult {
  reportVersion: string;
  scoreCount: number;
}

interface ScorePayload {
  id: string;
  name: string;
  value: number | string;
  dataType: 'NUMERIC' | 'BOOLEAN' | 'CATEGORICAL';
  sessionId?: string;
  comment: string;
}

interface ScoreDefinition {
  name: string;
  value: number | string;
  dataType: ScorePayload['dataType'];
}

/** 读取并校验可上传的评测报告。 */
export async function readEvalReport(reportPath: string): Promise<EvalReport> {
  const value: unknown = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  if (!isEvalReport(value)) throw new Error(`Invalid eval report: ${reportPath}`);
  return value;
}

/** 将评测报告中的整体汇总指标上传为 Langfuse Scores。 */
export async function uploadEvalReport(
  report: EvalReport,
  config: LangfuseUploadConfig,
): Promise<LangfuseUploadResult> {
  const reportVersion = report.resultVersion || `${report.dataset}-${report.generatedAt}`;
  const scores = buildReportScores(report, reportVersion);
  for (const score of scores) await postScore(config, score, report.generatedAt);
  return {
    reportVersion,
    scoreCount: scores.length,
  };
}

function buildReportScores(report: EvalReport, reportVersion: string): ScorePayload[] {
  const summaryScores = buildSummaryScores(report);
  return summaryScores.map((score, index) => ({
    ...score,
    id: scoreId(reportVersion, score.name, score.comment, index),
    sessionId: `eval-${reportVersion}`,
  }));
}

function buildSummaryScores(report: EvalReport): Array<Omit<ScorePayload, 'id'>> {
  const s = report.summary;
  const definitions: ScoreDefinition[] = [
    { name: 'eval_total_runs', value: s.totalRuns, dataType: 'NUMERIC' },
    { name: 'eval_passed_runs', value: s.passedRuns, dataType: 'NUMERIC' },
    { name: 'eval_judge_runs', value: s.judgeRuns, dataType: 'NUMERIC' },
    { name: 'eval_pass_at_1', value: s.passAt1, dataType: 'NUMERIC' },
    { name: 'eval_query_pass_at_1', value: s.queryPassAt1, dataType: 'NUMERIC' },
    { name: 'eval_answer_pass_at_1', value: s.answerPassAt1, dataType: 'NUMERIC' },
    { name: 'eval_pass_at_k', value: s.passAtK, dataType: 'NUMERIC' },
    { name: 'eval_pass_power_k', value: s.passPowerK, dataType: 'NUMERIC' },
    { name: 'eval_answer_gate_pass_at_1', value: s.answerGatePassAt1 ?? 0, dataType: 'NUMERIC' },
    {
      name: 'eval_evidence_gate_pass_at_1',
      value: s.evidenceGatePassAt1 ?? 0,
      dataType: 'NUMERIC',
    },
    { name: 'eval_quality_pass_at_1', value: s.qualityPassAt1 ?? 0, dataType: 'NUMERIC' },
    { name: 'eval_retrieval_coverage_rate', value: s.retrievalCoverageRate, dataType: 'NUMERIC' },
    { name: 'eval_citation_coverage_rate', value: s.citationCoverageRate, dataType: 'NUMERIC' },
    { name: 'eval_citation_accuracy_rate', value: s.citationAccuracyRate, dataType: 'NUMERIC' },
    {
      name: 'eval_citation_grounding_rate',
      value: s.citationGroundingRate ?? 0,
      dataType: 'NUMERIC',
    },
    { name: 'eval_abstention_accuracy', value: s.abstentionAccuracy, dataType: 'NUMERIC' },
    { name: 'eval_essential_pass_rate', value: s.essentialPassRate, dataType: 'NUMERIC' },
    { name: 'eval_important_pass_rate', value: s.importantPassRate, dataType: 'NUMERIC' },
    { name: 'eval_optional_pass_rate', value: s.optionalPassRate, dataType: 'NUMERIC' },
    { name: 'eval_tool_budget_pass_rate', value: s.toolBudgetPassRate, dataType: 'NUMERIC' },
    {
      name: 'eval_wiki_search_budget_pass_rate',
      value: s.wikiSearchBudgetPassRate,
      dataType: 'NUMERIC',
    },
    { name: 'eval_tool_success_rate', value: s.toolSuccessRate, dataType: 'NUMERIC' },
    { name: 'eval_average_latency_ms', value: s.averageLatencyMs, dataType: 'NUMERIC' },
    { name: 'eval_p95_latency_ms', value: s.p95LatencyMs, dataType: 'NUMERIC' },
    { name: 'eval_average_rounds', value: s.averageRounds, dataType: 'NUMERIC' },
    { name: 'eval_average_tool_calls', value: s.averageToolCalls, dataType: 'NUMERIC' },
    {
      name: 'eval_average_wiki_search_calls',
      value: s.averageWikiSearchCalls,
      dataType: 'NUMERIC',
    },
  ];
  if (typeof s.recallAtK === 'number')
    definitions.push({ name: 'eval_recall_at_5', value: s.recallAtK, dataType: 'NUMERIC' });
  if (s.judgeRuns > 0)
    definitions.push(
      { name: 'eval_judge_pass_at_1', value: s.judgePassAt1, dataType: 'NUMERIC' },
      { name: 'eval_average_judge_score', value: s.averageJudgeScore, dataType: 'NUMERIC' },
    );
  return definitions.map((definition) => ({
    ...definition,
    comment: `dataset=${report.dataset}; version=${report.version}; scope=summary`,
  }));
}

async function postScore(
  config: LangfuseUploadConfig,
  score: ScorePayload,
  timestamp: string,
): Promise<void> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/public/ingestion`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      batch: [{ id: score.id, timestamp, type: 'score-create', body: score }],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `Langfuse score upload failed: HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    );
  }
}

function scoreId(reportVersion: string, name: string, comment: string, index: number): string {
  const bytes = createHash('sha256')
    .update(`${reportVersion}|${name}|${comment}|${index}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isEvalReport(value: unknown): value is EvalReport {
  if (
    !isRecord(value) ||
    typeof value.dataset !== 'string' ||
    typeof value.version !== 'string' ||
    !Array.isArray(value.results) ||
    !isRecord(value.summary)
  )
    return false;
  const summary = value.summary;
  return (
    typeof summary.passAt1 === 'number' &&
    typeof summary.queryPassAt1 === 'number' &&
    typeof summary.answerPassAt1 === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
