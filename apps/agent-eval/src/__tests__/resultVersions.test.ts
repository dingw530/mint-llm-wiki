import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReport, type EvalCase, type EvalCaseResult, type EvalReport } from '../index.js';
import { createAutomaticVersionId, listResultVersions, markResultVersionLangfuseUploaded, readResultVersion, saveResultVersion } from '../resultVersions.js';

const temporaryDirectories: string[] = [];
const evalCase: EvalCase = { id: 'version-case', input: '测试', tags: ['qa'], expected: {} };

function result(passed: boolean): EvalCaseResult {
  return {
    caseId: evalCase.id, runIndex: 1, passed, queryPassed: passed, answerPassed: passed, retrievalPassed: passed,
    toolBudgetPassed: passed, abstentionPassed: passed, vetoed: false, essentialPassed: true, importantPassed: true,
    optionalPassed: true, rubricScore: 1, reasons: passed ? [] : ['failed'], content: '回答', citations: [], citationCount: 0,
    retrievedCitationCount: 0, citationCoverage: 0, retrievalCoverage: 0, abstained: false, rounds: 1, toolCalls: 0,
    attemptedToolCalls: 0, blockedToolCalls: 0, wikiSearchCalls: 0, attemptedWikiSearchCalls: 0, blockedWikiSearchCalls: 0,
    unrelatedToolCalls: 0, successfulToolCalls: 0, retries: 0, loopDetected: false, approvalRequired: false, latencyMs: 10,
  };
}

async function createDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-agent-eval-versions-'));
  temporaryDirectories.push(directory);
  return directory;
}

function report(passed: boolean, generatedAt: string): EvalReport {
  return { ...buildReport({ name: 'smoke', version: 'dataset-v1', cases: [evalCase] }, [result(passed)], 1), generatedAt };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe('eval result versions', () => {
  it('generates readable unique IDs for automatic saves', () => {
    const generatedAt = new Date('2026-08-25T10:00:17.123Z');
    expect(createAutomaticVersionId('wiki-rag', generatedAt, 'a1b2c3d4')).toBe('wiki-rag-20260825100017-a1b2c3d4');
    expect(createAutomaticVersionId('Wiki / RAG', generatedAt, 'e5f6a7b8')).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
  });

  it('saves, reads and lists immutable version reports', async () => {
    const directory = await createDirectory();
    await saveResultVersion({ ...report(true, '2026-08-25T10:00:00.000Z'), resultVersion: 'prompt-v1' }, 'prompt-v1', directory);
    await saveResultVersion({ ...report(false, '2026-08-25T11:00:00.000Z'), resultVersion: 'prompt-v2' }, 'prompt-v2', directory);

    const versions = await listResultVersions(directory);
    expect(versions.map(version => version.id)).toEqual(['prompt-v2', 'prompt-v1']);
    expect((await listResultVersions(directory, 'other')).length).toBe(0);
    expect((await readResultVersion('prompt-v1', directory)).resultVersion).toBe('prompt-v1');
  });

  it('rejects duplicate and unsafe version IDs without replacing the report', async () => {
    const directory = await createDirectory();
    const first = { ...report(true, '2026-08-25T10:00:00.000Z'), resultVersion: 'prompt-v1' };
    await saveResultVersion(first, 'prompt-v1', directory);
    await expect(saveResultVersion(report(false, '2026-08-25T11:00:00.000Z'), 'prompt-v1', directory)).rejects.toThrow('already exists');
    await expect(saveResultVersion(first, '../escape', directory)).rejects.toThrow('Invalid eval result version id');
    expect((await readResultVersion('prompt-v1', directory)).summary.passAt1).toBe(first.summary.passAt1);
  });

  it('reports missing versions and malformed indexes clearly', async () => {
    const directory = await createDirectory();
    await expect(readResultVersion('missing', directory)).rejects.toThrow('not found');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'index.json'), '{"schemaVersion":99,"versions":[]}', 'utf8');
    await expect(listResultVersions(directory)).rejects.toThrow('Invalid eval version index');
  });

  it('records Langfuse upload status in the version index without changing the report', async () => {
    const directory = await createDirectory();
    const saved = { ...report(true, '2026-08-25T10:00:00.000Z'), resultVersion: 'langfuse-v1' };
    await saveResultVersion(saved, 'langfuse-v1', directory);

    const marked = await markResultVersionLangfuseUploaded(directory, 'langfuse-v1', '2026-08-28T12:00:00.000Z', 12);

    expect(marked.langfuseUploadedAt).toBe('2026-08-28T12:00:00.000Z');
    expect(marked.langfuseScoreCount).toBe(12);
    expect((await listResultVersions(directory))[0]).toMatchObject({ langfuseUploadedAt: '2026-08-28T12:00:00.000Z', langfuseScoreCount: 12 });
    expect(await readResultVersion('langfuse-v1', directory)).toEqual(saved);
  });

  it('normalizes the legacy report alias before saving a new version', async () => {
    const directory = await createDirectory();
    const legacyReport = report(true, '2026-08-25T09:04:39.381Z');
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(legacyReport), 'utf8');
    await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify({ schemaVersion: 1, versions: [{
      id: 'report', dataset: 'smoke', datasetVersion: 'dataset-v1', reportFile: 'report.json',
    }] }), 'utf8');

    await saveResultVersion({ ...report(false, '2026-08-25T12:00:00.000Z'), resultVersion: 'prompt-v2' }, 'prompt-v2', directory);
    expect((await listResultVersions(directory)).map(version => version.id)).toEqual(['prompt-v2', 'report']);
  });

  it('preserves a recovery report when the index is unreadable', async () => {
    const directory = await createDirectory();
    await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify({ schemaVersion: 99, versions: [] }), 'utf8');
    const candidate = report(true, '2026-08-25T12:00:00.000Z');
    await expect(saveResultVersion(candidate, 'recovery-v1', directory)).rejects.toThrow('report preserved at');
    const recovered = JSON.parse(await fs.readFile(path.join(directory, 'recovery', 'recovery-v1.json'), 'utf8')) as EvalReport;
    expect(recovered.summary.totalRuns).toBe(candidate.summary.totalRuns);
  });
});
