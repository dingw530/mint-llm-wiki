import { cpus, platform, arch } from 'node:os';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import recallFixture from './fixtures/recall-cases.json';
import { getDb } from '../../../db.js';
import * as memoryRepository from '../../../infrastructure/persistence/memoryRepository.js';
import { initializeMemorySearchIndex, prepareMemoryContext } from '../index.js';
import { MEMORY_RETRIEVAL_POLICY_VERSION } from '../memoryPolicy.js';

interface RecallCase {
  caseId: string;
  query: string;
  expectedIds: string[];
  scopeKind: 'global' | 'space';
  spaceId: string | null;
  lexicallyAnswerable: boolean;
  content?: string;
}

interface RecallFixture {
  version: string;
  cases: RecallCase[];
}

const fixture = recallFixture as RecallFixture;
const FIXTURE_SIZE = 10_000;
const FIRST_SPACE_ID = 'quality-space-a';
const SECOND_SPACE_ID = 'quality-space-b';

function insertFixture(): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO memory_spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(FIRST_SPACE_ID, 'quality fixture A', now, now);
  db.prepare(
    'INSERT INTO memory_spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(SECOND_SPACE_ID, 'quality fixture B', now, now);

  const insert = db.prepare(`
    INSERT INTO memories (
      id, content, category, memory_key, value_json, memory_type, subject,
      confidence, importance, status, access_count, source_conversation_id,
      created_at, updated_at, context_policy, policy_source, scope_kind, space_id
    ) VALUES (?, ?, 'general', ?, NULL, 'semantic', 'user', 0.9, 0.5, 'active', 0,
      NULL, ?, ?, 'retrievable', 'auto', ?, ?)
  `);
  const records = fixture.cases.filter((item) => item.expectedIds.length > 0);
  const transaction = db.transaction(() => {
    for (const item of records) {
      const id = item.expectedIds[0];
      insert.run(
        id,
        item.content,
        `quality.${item.caseId.toLowerCase()}`,
        now,
        now,
        item.scopeKind,
        item.spaceId,
      );
    }
    for (let index = records.length; index < FIXTURE_SIZE; index += 1) {
      const suffix = String(index).padStart(5, '0');
      insert.run(
        `quality-noise-${suffix}`,
        `qznoiseitem${suffix} vvvz${suffix} archivedfact${suffix}`,
        `quality.noise.${suffix}`,
        now,
        now,
        'global',
        null,
      );
    }
  });
  transaction();
}

function cleanupFixture(): void {
  const db = getDb();
  db.prepare("DELETE FROM memory_search_documents_fts WHERE memory_id LIKE 'quality-%'").run();
  db.prepare("DELETE FROM memories WHERE id LIKE 'quality-%'").run();
  db.prepare('DELETE FROM memory_spaces WHERE id IN (?, ?)').run(FIRST_SPACE_ID, SECOND_SPACE_ID);
}

function getScope(item: RecallCase) {
  return {
    scopeKind: item.scopeKind,
    spaceId: item.spaceId,
    bindingRevision: 1,
  } as const;
}

function retrieve(item: RecallCase) {
  return prepareMemoryContext(item.query, getScope(item), {
    totalTokens: 2_000,
    coreTokens: 500,
    inputBudget: 95_904,
    remainingInputTokens: 2_000,
  });
}

function measureQuality() {
  const answerable = fixture.cases.filter((item) => item.lexicallyAnswerable);
  let expectedCount = 0;
  let recalledCount = 0;
  let selectedCount = 0;
  let unrelatedSelectedCount = 0;
  let crossScopeFalseRetrievalCount = 0;
  const newByCase = [] as Array<{ caseId: string; expectedIds: string[]; selectedIds: string[] }>;

  for (const item of fixture.cases) {
    const result = retrieve(item);
    const selectedIds = [
      ...result.observation.selectedCoreIds,
      ...result.observation.selectedRetrievalIds,
    ];
    const expected = new Set(item.expectedIds);
    selectedCount += selectedIds.length;
    unrelatedSelectedCount += selectedIds.filter((id) => !expected.has(id)).length;
    if (item.lexicallyAnswerable) {
      expectedCount += item.expectedIds.length;
      recalledCount += item.expectedIds.filter((id) => selectedIds.includes(id)).length;
    }
    const selectedRows = memoryRepository.findByIds(selectedIds);
    for (const row of selectedRows) {
      if (item.scopeKind === 'global' && row.scopeKind !== 'global') {
        crossScopeFalseRetrievalCount += 1;
      } else if (
        item.scopeKind === 'space' &&
        row.scopeKind === 'space' &&
        row.spaceId !== item.spaceId
      ) {
        crossScopeFalseRetrievalCount += 1;
      }
    }
    newByCase.push({ caseId: item.caseId, expectedIds: item.expectedIds, selectedIds });
  }

  const oldProfile = memoryRepository.findActiveProfile(24);
  const oldByCase = fixture.cases.map((item) => {
    const legacy = [...oldProfile, ...memoryRepository.search(item.query, 8)].filter(
      (memory, index, list) => list.findIndex(({ id }) => id === memory.id) === index,
    );
    return {
      caseId: item.caseId,
      expectedIds: item.expectedIds,
      selectedIds: legacy.map(({ id }) => id),
    };
  });
  const oldRecallCount = answerable.reduce(
    (sum, item) =>
      sum +
      item.expectedIds.filter((id) =>
        oldByCase.find((result) => result.caseId === item.caseId)?.selectedIds.includes(id),
      ).length,
    0,
  );
  const oldSelectedCount = oldByCase.reduce((sum, item) => sum + item.selectedIds.length, 0);
  const oldUnrelatedSelectedCount = oldByCase.reduce((sum, item) => {
    const expected = new Set(item.expectedIds);
    return sum + item.selectedIds.filter((id) => !expected.has(id)).length;
  }, 0);
  return {
    fixtureVersion: fixture.version,
    caseCount: fixture.cases.length,
    lexicallyAnswerableCaseCount: answerable.length,
    fixtureMemoryCount: FIXTURE_SIZE,
    old24Plus8RecallAt8: expectedCount === 0 ? 0 : oldRecallCount / expectedCount,
    old24Plus8UnrelatedInjectionRate:
      oldSelectedCount === 0 ? 0 : oldUnrelatedSelectedCount / oldSelectedCount,
    recallAt8: expectedCount === 0 ? 0 : recalledCount / expectedCount,
    unrelatedInjectionRate: selectedCount === 0 ? 0 : unrelatedSelectedCount / selectedCount,
    crossScopeFalseRetrievalCount,
    selectedCount,
    newByCase,
    oldByCase,
  };
}

describe('memory recall quality and 10k fixture performance', () => {
  beforeAll(() => {
    cleanupFixture();
    insertFixture();
    getDb().prepare('UPDATE memory_search_meta SET tokenizer_version = 0 WHERE id = 1').run();
  });

  afterAll(() => cleanupFixture());

  it('meets fixed recall, injection, scope, and 10k-row p95 targets', () => {
    const coldStart = performance.now();
    initializeMemorySearchIndex();
    const coldIndexRebuildMs = performance.now() - coldStart;
    const quality = measureQuality();
    const answerable = fixture.cases.filter((item) => item.lexicallyAnswerable);
    for (let index = 0; index < 20; index += 1) retrieve(answerable[index % answerable.length]);
    const samples: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const item = fixture.cases[index % fixture.cases.length];
      const start = performance.now();
      retrieve(item);
      samples.push(performance.now() - start);
    }
    samples.sort((left, right) => left - right);
    const latency = {
      warmupCount: 20,
      measurementCount: 100,
      p50Ms: Number(samples[Math.floor(samples.length * 0.5)].toFixed(3)),
      p95Ms: Number(samples[Math.ceil(samples.length * 0.95) - 1].toFixed(3)),
      coldIndexRebuildMs: Number(coldIndexRebuildMs.toFixed(3)),
    };
    const report = {
      ...quality,
      retrievalPolicyVersion: MEMORY_RETRIEVAL_POLICY_VERSION,
      latency,
      environment: {
        node: process.version,
        sqlite: (getDb().prepare('SELECT sqlite_version() AS version').get() as { version: string })
          .version,
        platform: `${platform()}-${arch()}`,
        cpu: cpus()[0]?.model || 'unknown',
      },
    };
    console.info(`[memory-quality-report] ${JSON.stringify(report)}`);
    const reportPath = process.env.MINT_MEMORY_QUALITY_REPORT_PATH;
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    expect(report.caseCount).toBeGreaterThanOrEqual(30);
    expect(report.recallAt8).toBeGreaterThanOrEqual(0.85);
    expect(report.unrelatedInjectionRate).toBeLessThanOrEqual(0.1);
    expect(report.crossScopeFalseRetrievalCount).toBe(0);
    expect(latency.p95Ms).toBeLessThanOrEqual(100);
  });
});
