import type { EvalCase, EvalCaseResult, EvalDataset, EvalReport } from './index.js';

export type PairwiseWinner = 'a' | 'b' | 'tie';
export interface PairwiseJudgeInput { evalCase: EvalCase; first: EvalCaseResult; second: EvalCaseResult; }
export interface PairwiseJudgment { winner: PairwiseWinner; confidence: number; reason: string; }
export type PairwiseJudgeExecutor = (input: PairwiseJudgeInput) => Promise<PairwiseJudgment>;
export interface PairwiseMatch { caseId: string; runIndex: number; winner: PairwiseWinner; forward: PairwiseJudgment; reverse: PairwiseJudgment; }
export interface PairwiseReport { labelA: string; labelB: string; total: number; winsA: number; winsB: number; ties: number; positionDisagreements: number; matches: PairwiseMatch[]; }

function reportResult(report: EvalReport, caseId: string, runIndex: number): EvalCaseResult | undefined {
  return report.results.find(result => result.caseId === caseId && result.runIndex === runIndex);
}

function reverseWinner(winner: PairwiseWinner): PairwiseWinner {
  return winner === 'a' ? 'b' : winner === 'b' ? 'a' : 'tie';
}

function deterministicWinner(left: EvalCaseResult, right: EvalCaseResult): PairwiseWinner | undefined {
  if (left.passed === right.passed) return undefined;
  return left.passed ? 'a' : 'b';
}

/** 用交换候选顺序的双次判定缓解位置偏差，分歧时保守记为平局。 */
export async function runPairwiseComparison(dataset: EvalDataset, reportA: EvalReport, reportB: EvalReport, labelA: string, labelB: string, judge: PairwiseJudgeExecutor): Promise<PairwiseReport> {
  const matches: PairwiseMatch[] = [];
  for (const evalCase of dataset.cases) {
    const runCount = Math.min(reportA.runsPerCase, reportB.runsPerCase);
    for (let runIndex = 1; runIndex <= runCount; runIndex += 1) {
      const first = reportResult(reportA, evalCase.id, runIndex); const second = reportResult(reportB, evalCase.id, runIndex);
      if (!first || !second) continue;
      const forcedWinner = deterministicWinner(first, second);
      if (forcedWinner) {
        const forced: PairwiseJudgment = { winner: forcedWinner, confidence: 1, reason: 'deterministic hard gate result differs' };
        matches.push({ caseId: evalCase.id, runIndex, winner: forcedWinner, forward: forced, reverse: forced });
        continue;
      }
      const forward = await judge({ evalCase, first, second });
      const reverse = await judge({ evalCase, first: second, second: first });
      const reversed = reverseWinner(reverse.winner);
      const winner = forward.winner === reversed ? forward.winner : 'tie';
      matches.push({ caseId: evalCase.id, runIndex, winner, forward, reverse });
    }
  }
  const winsA = matches.filter(match => match.winner === 'a').length;
  const winsB = matches.filter(match => match.winner === 'b').length;
  return { labelA, labelB, total: matches.length, winsA, winsB, ties: matches.length - winsA - winsB, positionDisagreements: matches.filter(match => match.forward.winner !== reverseWinner(match.reverse.winner)).length, matches };
}

/** 使用标准 Elo 在线更新计算一组配对结果的相对排名。 */
export function calculateElo(report: PairwiseReport, initialRating = 1000, kFactor = 32): Record<string, number> {
  if (!Number.isFinite(initialRating) || !Number.isFinite(kFactor) || kFactor <= 0) throw new Error('Invalid Elo parameters');
  const ratings: Record<string, number> = { [report.labelA]: initialRating, [report.labelB]: initialRating };
  for (const match of report.matches) {
    const expectedA = 1 / (1 + 10 ** ((ratings[report.labelB] - ratings[report.labelA]) / 400));
    const actualA = match.winner === 'a' ? 1 : match.winner === 'b' ? 0 : 0.5;
    const adjustment = kFactor * (actualA - expectedA);
    ratings[report.labelA] += adjustment;
    ratings[report.labelB] -= adjustment;
  }
  return ratings;
}
