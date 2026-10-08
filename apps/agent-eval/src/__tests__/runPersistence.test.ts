import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type EvalCase, type EvalCaseResult } from '../index.js';
import { appendEvalRunResult, createEvalRun, readEvalRun } from '../runPersistence.js';

const temporaryDirectories: string[] = [];
const evalCase: EvalCase = { id: 'checkpoint-case', input: '测试', tags: ['qa'], expected: {} };

function result(runIndex: number): EvalCaseResult {
  return {
    caseId: evalCase.id, runIndex, passed: true, queryPassed: true, answerPassed: true, retrievalPassed: true,
    toolBudgetPassed: true, abstentionPassed: true, vetoed: false, essentialPassed: true, importantPassed: true,
    optionalPassed: true, reasons: [], content: '回答', citations: [], citationCount: 0, retrievedCitationCount: 0,
    citationCoverage: 0, retrievalCoverage: 0, abstained: false, rounds: 1, toolCalls: 0, attemptedToolCalls: 0,
    blockedToolCalls: 0, wikiSearchCalls: 0, attemptedWikiSearchCalls: 0, blockedWikiSearchCalls: 0,
    unrelatedToolCalls: 0, successfulToolCalls: 0, retries: 0, loopDetected: false, approvalRequired: false,
    latencyMs: 10,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe('eval run persistence', () => {
  it('atomically checkpoints completed results for recovery', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-agent-eval-runs-'));
    temporaryDirectories.push(root);
    const directory = path.join(root, 'run-1');
    await createEvalRun(directory, { runId: 'run-1', dataset: 'smoke', datasetVersion: 'v1', runsPerCase: 2, totalRuns: 2 });
    await appendEvalRunResult(directory, result(1));
    const checkpoint = await readEvalRun(directory);
    expect(checkpoint.results).toHaveLength(1);
    expect(checkpoint.results[0].runIndex).toBe(1);
  });

  it('rejects duplicate checkpoints instead of overwriting a completed run', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-agent-eval-runs-'));
    temporaryDirectories.push(root);
    const directory = path.join(root, 'run-1');
    await createEvalRun(directory, { runId: 'run-1', dataset: 'smoke', datasetVersion: 'v1', runsPerCase: 1, totalRuns: 1 });
    await appendEvalRunResult(directory, result(1));
    await expect(appendEvalRunResult(directory, result(1))).rejects.toThrow('already exists');
  });
});
