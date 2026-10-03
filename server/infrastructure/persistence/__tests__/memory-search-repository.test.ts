import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../db.js';
import * as memoryService from '../../../domains/memory/index.js';
import { createMemorySpaceService } from '../../../domains/memory/index.js';
import * as memoryScopeRepository from '../memory-scope-repository.js';
import * as memoryRepository from '../memory-repository.js';
import * as memorySearchRepository from '../memory-search-repository.js';

const memoryIds = [
  'memory-search-global',
  'memory-search-alpha',
  'memory-search-beta',
  'memory-search-expired',
  'memory-search-future',
  'memory-search-unassigned',
  'memory-search-edit',
  'memory-search-chinese',
  'memory-search-rollback',
];

describe('memory search repository integration', () => {
  afterEach(() => {
    getDb()
      .prepare(
        "DELETE FROM memory_search_documents_fts WHERE memory_id IN (SELECT id FROM memories WHERE source_message_id = 'memory-search-core-source')",
      )
      .run();
    getDb()
      .prepare("DELETE FROM memories WHERE source_message_id = 'memory-search-core-source'")
      .run();
    getDb()
      .prepare(
        "DELETE FROM memory_events WHERE conversation_id = 'memory-search-core-conversation'",
      )
      .run();
    getDb().prepare("DELETE FROM messages WHERE id = 'memory-search-core-source'").run();
    getDb().prepare("DELETE FROM conversations WHERE id = 'memory-search-core-conversation'").run();
    getDb()
      .prepare(
        `DELETE FROM memory_search_documents_fts WHERE memory_id IN (${memoryIds.map(() => '?').join(', ')})`,
      )
      .run(...memoryIds);
    getDb()
      .prepare(`DELETE FROM memories WHERE id IN (${memoryIds.map(() => '?').join(', ')})`)
      .run(...memoryIds);
    getDb()
      .prepare(
        "DELETE FROM memory_spaces WHERE name = 'search-test-alpha' OR name = 'search-test-beta'",
      )
      .run();
    vi.restoreAllMocks();
  });

  it('filters FTS results by scope, active validity, and index availability', () => {
    const alpha = memoryScopeRepository.createSpace('search-test-alpha');
    const beta = memoryScopeRepository.createSpace('search-test-beta');
    memoryService.createMemory({
      id: 'memory-search-global',
      content: 'The Mint server uses TypeScript and Express',
      memoryKey: 'project.mint.stack',
    });
    memoryService.createMemory({
      id: 'memory-search-chinese',
      content: 'Mint 的响应语言使用中文',
      memoryKey: 'preference.response_language',
    });
    memoryService.createMemory({
      id: 'memory-search-alpha',
      content: 'Project alpha stores records in SQLite',
      memoryKey: 'project.alpha.storage',
      scopeKind: 'space',
      spaceId: alpha.id,
    });
    memoryService.createMemory({
      id: 'memory-search-beta',
      content: 'Project beta stores vectors in Chroma',
      memoryKey: 'project.beta.storage',
      scopeKind: 'space',
      spaceId: beta.id,
    });
    memoryService.createMemory({
      id: 'memory-search-expired',
      content: 'Legacy TypeScript architecture',
      memoryKey: 'project.old.stack',
      validTo: '2020-01-01T00:00:00.000Z',
    });
    memoryService.createMemory({
      id: 'memory-search-future',
      content: 'Ruby future framework',
      memoryKey: 'project.future.stack',
      validFrom: '2099-01-01T00:00:00.000Z',
    });
    memoryRepository.create({
      id: 'memory-search-unassigned',
      content: 'Legacy secret scope marker',
      memoryKey: 'legacy.private',
      scopeKind: 'unassigned',
    });

    getDb().prepare('UPDATE memory_search_meta SET tokenizer_version = 0 WHERE id = 1').run();
    expect(memoryService.buildMemoryContext('TypeScript')).toContain('TypeScript');
    expect(
      getDb().prepare('SELECT access_count FROM memories WHERE id = ?').get('memory-search-global'),
    ).toEqual({ access_count: 1 });
    expect(
      getDb()
        .prepare('SELECT access_count FROM memories WHERE id = ?')
        .get('memory-search-chinese'),
    ).toEqual({ access_count: 0 });
    expect(memoryService.buildMemoryContext('响应语言')).toContain('响应语言');
    expect(
      getDb().prepare('SELECT tokenizer_version FROM memory_search_meta WHERE id = 1').get(),
    ).toEqual({ tokenizer_version: 1 });

    expect(memoryService.buildMemoryContext('alpha SQLite')).toBe('');
    const alphaContext = memoryService.buildMemoryContext('alpha SQLite', {
      scopeKind: 'space',
      spaceId: alpha.id,
      bindingRevision: 2,
    });
    expect(alphaContext).toContain('Project alpha');
    expect(alphaContext).not.toContain('Project beta');
    expect(memoryService.buildMemoryContext('legacy secret')).toBe('');
    expect(memoryService.buildMemoryContext('TypeScript architecture')).not.toContain(
      'Legacy TypeScript',
    );
    expect(memoryService.buildMemoryContext('Ruby future')).toBe('');
    expect(
      memoryService.buildMemoryContext('vectors Chroma', {
        scopeKind: 'space',
        spaceId: beta.id,
        bindingRevision: 1,
      }),
    ).toContain('Project beta');
    memoryScopeRepository.archiveSpace(beta.id);
    expect(
      memoryService.buildMemoryContext('vectors Chroma', {
        scopeKind: 'space',
        spaceId: beta.id,
        bindingRevision: 1,
      }),
    ).toBe('');
  });

  it('updates the FTS projection in the same transaction as a fact edit', () => {
    memoryService.createMemory({
      id: 'memory-search-edit',
      content: 'The user likes the old language',
      memoryKey: 'preference.language',
    });
    expect(memoryService.buildMemoryContext('old language')).toContain('old language');

    memoryService.updateMemory('memory-search-edit', {
      content: 'The user likes the new language',
    });

    expect(memoryService.buildMemoryContext('old')).toBe('');
    expect(memoryService.buildMemoryContext('new language')).toContain('new language');
  });

  it('adds a legacy unassigned fact to FTS only when a user assigns its scope', () => {
    memoryRepository.create({
      id: 'memory-search-unassigned',
      content: 'Legacy secret scope marker',
      memoryKey: 'legacy.private',
      scopeKind: 'unassigned',
    });
    expect(memoryService.buildMemoryContext('legacy secret')).toBe('');
    expect(
      getDb()
        .prepare(
          "SELECT count(*) AS count FROM memory_search_documents_fts WHERE memory_id = 'memory-search-unassigned'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const scopeService = createMemorySpaceService(memoryScopeRepository);
    expect(scopeService.assignMemories(['memory-search-unassigned'], 'global', null)).toEqual({
      updated: 1,
    });
    expect(
      getDb()
        .prepare(
          "SELECT count(*) AS count FROM memory_search_documents_fts WHERE memory_id = 'memory-search-unassigned'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(memoryService.buildMemoryContext('legacy secret')).toContain('Legacy secret');
  });

  it('rolls back a fact write when its FTS projection fails', () => {
    const projection = vi.spyOn(memorySearchRepository, 'upsertDocument').mockImplementation(() => {
      throw new Error('injected FTS write failure');
    });

    expect(() =>
      memoryService.createMemory({
        id: 'memory-search-rollback',
        content: 'transactional search fact',
      }),
    ).toThrow('injected FTS write failure');
    expect(
      getDb().prepare("SELECT id FROM memories WHERE id = 'memory-search-rollback'").get(),
    ).toBeUndefined();
    projection.mockRestore();
  });

  it('injects eligible core facts without a query and updates access only when selected', () => {
    getDb()
      .prepare("INSERT INTO conversations (id) VALUES ('memory-search-core-conversation')")
      .run();
    getDb()
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content) VALUES ('memory-search-core-source', 'memory-search-core-conversation', 'user', '以后请用中文回复')",
      )
      .run();
    const [created] = memoryService.applyMemoryOperations(
      [
        {
          action: 'ADD',
          memoryKey: 'preference.response_language',
          subject: 'user',
          content: '用户希望之后使用中文回复',
          confidence: 0.95,
          sourceMessageId: 'memory-search-core-source',
        },
      ],
      'memory-search-core-conversation',
    );
    expect(created.contextPolicy).toBe('core');

    const scope = { scopeKind: 'global' as const, spaceId: null, bindingRevision: 1 };
    const result = memoryService.prepareMemoryContext(undefined, scope);
    expect(result.observation.selectedCoreIds).toEqual([created.id]);
    expect(memoryService.buildMemoryContext()).toContain('中文回复');
    expect(
      getDb().prepare('SELECT access_count FROM memories WHERE id = ?').get(created.id),
    ).toEqual({ access_count: 2 });

    memoryService.prepareMemoryContext(undefined, scope, {
      totalTokens: 0,
      coreTokens: 0,
      inputBudget: 0,
      remainingInputTokens: 0,
    });
    expect(
      getDb().prepare('SELECT access_count FROM memories WHERE id = ?').get(created.id),
    ).toEqual({ access_count: 2 });
  });
});
