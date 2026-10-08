import type { EvalJudgeDimensionResult, EvalReport } from './index.js';

export interface CalibrationLabel {
  caseId: string;
  runIndex: number;
  passed: boolean;
  answerGatePassed?: boolean;
  evidenceGatePassed?: boolean;
  dimensions: EvalJudgeDimensionResult[];
}

export interface CalibrationComparison {
  matched: number;
  passAgreementRate: number;
  dimensionExactAgreementRate: number;
  meanAbsoluteError: number;
  answerGateAgreementRate: number;
  evidenceGateAgreementRate: number;
  minimumSamples: number;
  sampleSufficient: boolean;
  calibrated: boolean;
  disagreements: Array<{ caseId: string; runIndex: number; reason: string }>;
}

const MINIMUM_CALIBRATION_SAMPLES = 20;
const MINIMUM_CALIBRATION_AGREEMENT = 0.8;

/** 导出可由人工填写的 Judge 校准模板，保留原始评测上下文。 */
export function buildCalibrationTemplate(report: EvalReport): { dataset: string; version: string; labels: CalibrationLabel[] } {
  return {
    dataset: report.dataset,
    version: report.version,
    labels: report.results.filter(result => result.judge && !result.judge.skipped).map(result => ({
      caseId: result.caseId,
      runIndex: result.runIndex,
      passed: false,
      answerGatePassed: false,
      evidenceGatePassed: false,
      dimensions: result.judge!.dimensions.map(dimension => ({ ...dimension, score: dimension.score, passed: dimension.passed, evidenceIds: [], reason: '' })),
    })),
  };
}

/** 将人工标注与 Judge 结果逐题对齐，输出可复核的一致性度量。 */
export function compareCalibration(report: EvalReport, labels: CalibrationLabel[]): CalibrationComparison {
  const labelsByRun = new Map(labels.map(label => [`${label.caseId}:${label.runIndex}`, label]));
  let matched = 0; let passMatches = 0; let answerGateMatches = 0; let answerGateCount = 0; let evidenceGateMatches = 0; let evidenceGateCount = 0; let dimensionMatches = 0; let dimensionCount = 0; let absoluteError = 0;
  const disagreements: CalibrationComparison['disagreements'] = [];
  for (const result of report.results) {
    if (!result.judge || result.judge.skipped) continue;
    const label = labelsByRun.get(`${result.caseId}:${result.runIndex}`);
    if (!label) continue;
    matched += 1;
    if (label.passed === result.judgePassed) passMatches += 1;
    else disagreements.push({ caseId: result.caseId, runIndex: result.runIndex, reason: 'overall pass disagreement' });
    if (label.answerGatePassed !== undefined && result.judge.answerGatePassed !== undefined) {
      answerGateCount += 1;
      if (label.answerGatePassed === result.judge.answerGatePassed) answerGateMatches += 1;
      else disagreements.push({ caseId: result.caseId, runIndex: result.runIndex, reason: 'answer gate disagreement' });
    }
    if (label.evidenceGatePassed !== undefined && result.judge.evidenceGatePassed !== undefined) {
      evidenceGateCount += 1;
      if (label.evidenceGatePassed === result.judge.evidenceGatePassed) evidenceGateMatches += 1;
      else disagreements.push({ caseId: result.caseId, runIndex: result.runIndex, reason: 'evidence gate disagreement' });
    }
    const humanDimensions = new Map(label.dimensions.map(dimension => [dimension.id, dimension]));
    for (const judgeDimension of result.judge.dimensions) {
      const humanDimension = humanDimensions.get(judgeDimension.id);
      if (!humanDimension) continue;
      dimensionCount += 1;
      if (judgeDimension.score !== undefined && humanDimension.score !== undefined) {
        absoluteError += Math.abs(judgeDimension.score - humanDimension.score);
        if (judgeDimension.score === humanDimension.score) dimensionMatches += 1;
      } else if (judgeDimension.passed === humanDimension.passed) dimensionMatches += 1;
      else disagreements.push({ caseId: result.caseId, runIndex: result.runIndex, reason: `dimension disagreement: ${judgeDimension.id}` });
    }
  }
  const passAgreementRate = passMatches / Math.max(1, matched);
  const answerGateAgreementRate = answerGateMatches / Math.max(1, answerGateCount);
  const evidenceGateAgreementRate = evidenceGateMatches / Math.max(1, evidenceGateCount);
  const dimensionExactAgreementRate = dimensionMatches / Math.max(1, dimensionCount);
  const meanAbsoluteError = absoluteError / Math.max(1, dimensionCount);
  const sampleSufficient = matched >= MINIMUM_CALIBRATION_SAMPLES;
  const calibrated = sampleSufficient
    && passAgreementRate >= MINIMUM_CALIBRATION_AGREEMENT
    && answerGateCount >= MINIMUM_CALIBRATION_SAMPLES
    && evidenceGateCount >= MINIMUM_CALIBRATION_SAMPLES
    && answerGateAgreementRate >= MINIMUM_CALIBRATION_AGREEMENT
    && evidenceGateAgreementRate >= MINIMUM_CALIBRATION_AGREEMENT
    && dimensionExactAgreementRate >= MINIMUM_CALIBRATION_AGREEMENT;
  return { matched, passAgreementRate, dimensionExactAgreementRate, meanAbsoluteError, answerGateAgreementRate, evidenceGateAgreementRate, minimumSamples: MINIMUM_CALIBRATION_SAMPLES, sampleSufficient, calibrated, disagreements };
}
