import { v4 as uuidv4 } from 'uuid';
import * as memoryRepo from '../../infrastructure/persistence/memory-repository.js';
import * as memorySearchRepo from '../../infrastructure/persistence/memory-search-repository.js';
import type { AiSettings } from '../../types.js';
import type {
  CreateMemoryParams,
  Memory,
  MemoryListFilters,
  MemoryExtractionMessage,
  MemoryOperation,
  MemoryScopeSnapshot,
  MemoryOperationAction,
  UpdateMemoryParams,
} from './types.js';
import type { MemoryGateResolution } from './gates/types.js';
import {
  analyzeMemoryQuery,
  buildMemoryFtsExpression,
  MEMORY_TOKENIZER_VERSION,
  rankMemoryCandidates,
  toMemorySearchDocument,
} from './memory-query.js';
import { canonicalMemoryKey, normalizeMemoryOperations } from './memory-semantic-policy.js';
import type { MemorySemanticClassifier } from './memory-semantic-policy.js';
import { shouldPromoteToCore } from './memory-core-policy.js';
import { packMemoryContext } from './memory-context-packing.js';
import type { MemoryContextPackingResult, MemoryPackingBudget } from './memory-context-packing.js';
import type { MemoryExtractionClient } from './ports.js';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  MAX_MEMORY_CONTENT_LENGTH,
  MAX_MEMORY_KEY_LENGTH,
  MAX_MEMORY_SUBJECT_LENGTH,
  MAX_MEMORY_VALUE_LENGTH,
  MEMORY_EXTRACTION_TIMEOUT_MS,
  MEMORY_CANDIDATE_LIMIT,
  MEMORY_RECALL_LIMIT,
  MEMORY_QUERY_CHARACTER_LIMIT,
} from './memory-policy.js';

export { CATEGORY_LABELS, CATEGORY_ORDER };

// ── CRUD 包装函数 ──

export function listMemories(category?: string): Memory[] {
  if (category) {
    return memoryRepo.findByCategory(category);
  }
  return memoryRepo.findAll();
}

/** Validate management filters separately from answer-time recall. */
export function listManagedMemories(filters: MemoryListFilters = {}): Memory[] {
  if (
    filters.scopeKind !== undefined &&
    !['global', 'space', 'unassigned'].includes(filters.scopeKind)
  ) {
    throw new Error('Memory scope filter is invalid');
  }
  if (
    filters.contextPolicy !== undefined &&
    !['core', 'retrievable'].includes(filters.contextPolicy)
  ) {
    throw new Error('Memory context policy filter is invalid');
  }
  if (filters.spaceId && filters.scopeKind && filters.scopeKind !== 'space') {
    throw new Error('Space id requires a space scope filter');
  }
  return memoryRepo.findManaged(filters);
}

export function createMemory(data: CreateMemoryParams): Memory {
  validateTemporalRange(data.validFrom ?? null, data.validTo ?? null);
  validateWritableScope(data.scopeKind ?? 'global', data.spaceId ?? null);
  return memoryRepo.withTransaction(() => {
    if (data.scopeKind === 'space' && !memoryRepo.isMemorySpaceActive(data.spaceId!)) {
      throw new Error('Memory space is unavailable');
    }
    const memory = memoryRepo.create({
      ...data,
      policySource: 'user',
      scopeKind: data.scopeKind ?? 'global',
      spaceId: data.spaceId ?? null,
    });
    memorySearchRepo.upsertDocument(toMemorySearchDocument(memory));
    return memory;
  });
}

export function updateMemory(id: string, data: UpdateMemoryParams): Memory | null {
  if (data.scopeKind !== undefined || data.spaceId !== undefined) {
    throw new Error('Memory scope changes must use the batch assignment operation');
  }
  return memoryRepo.withTransaction(() => {
    const current = memoryRepo.findById(id);
    if (!current) return null;
    validateTemporalRange(
      data.validFrom ?? current.validFrom ?? null,
      data.validTo ?? current.validTo ?? null,
    );
    const updated = memoryRepo.update(id, {
      ...data,
      policySource: data.contextPolicy !== undefined ? 'user' : current.policySource,
    });
    if (updated) memorySearchRepo.upsertDocument(toMemorySearchDocument(updated));
    return updated;
  });
}

function validateWritableScope(scopeKind: string, spaceId: string | null): void {
  if (!['global', 'space'].includes(scopeKind) || (scopeKind === 'space') !== (spaceId !== null)) {
    throw new Error('Memory scope is invalid');
  }
}

function validateTemporalRange(validFrom: string | null, validTo: string | null): void {
  const from = validFrom == null ? null : Date.parse(validFrom);
  const to = validTo == null ? null : Date.parse(validTo);
  if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to))) {
    throw new Error('Memory validity dates must be valid timestamps');
  }
  if (from !== null && to !== null && to <= from) {
    throw new Error('Memory validTo must be later than validFrom');
  }
}

export function deleteMemory(id: string): void {
  memoryRepo.withTransaction(() => {
    memoryRepo.deleteById(id);
    memorySearchRepo.deleteDocument(id);
  });
}

// ── 构建记忆上下文 ──

export function buildMemoryContext(
  query?: string,
  scope: MemoryScopeSnapshot = {
    scopeKind: 'global',
    spaceId: null,
    bindingRevision: 0,
  },
  budget: MemoryPackingBudget = {},
): string {
  return prepareMemoryContext(query, scope, budget).text;
}

/** Prepare core and lexical facts plus content-free diagnostics for one request. */
export function prepareMemoryContext(
  query?: string,
  scope: MemoryScopeSnapshot = {
    scopeKind: 'global',
    spaceId: null,
    bindingRevision: 0,
  },
  budget: MemoryPackingBudget = {},
): MemoryContextPackingResult {
  const now = new Date().toISOString();
  const analysis = analyzeMemoryQuery((query || '').slice(0, MEMORY_QUERY_CHARACTER_LIMIT));
  const diagnostics = {
    ftsUnavailable: false,
    coreReadFailed: false,
    rawCandidateCount: 0,
    relevantCandidateCount: 0,
  };
  const core = readCoreCandidates(scope, now, diagnostics);
  let relevant: Memory[] = [];
  if (scope.scopeKind !== 'unassigned' && analysis.tokens.length > 0) {
    try {
      ensureMemorySearchIndex();
      const rawCandidates = memorySearchRepo.searchCandidates(
        buildMemoryFtsExpression(analysis.tokens),
        scope,
        now,
        MEMORY_CANDIDATE_LIMIT,
      );
      diagnostics.rawCandidateCount = rawCandidates.length;
      relevant = rankMemoryCandidates(analysis, rawCandidates).slice(0, MEMORY_RECALL_LIMIT);
      diagnostics.relevantCandidateCount = relevant.length;
    } catch {
      diagnostics.ftsUnavailable = true;
    }
  }
  const result = packMemoryContext(core, relevant, scope, budget);
  addContextSkipReasons(result, query, scope, analysis.tokens.length, diagnostics);
  recordSelectedAccess(result);
  return result;
}

function readCoreCandidates(
  scope: MemoryScopeSnapshot,
  now: string,
  diagnostics: { coreReadFailed: boolean },
): Memory[] {
  if (scope.scopeKind === 'unassigned') return [];
  try {
    return memoryRepo
      .findCoreCandidates(scope, now)
      .filter((candidate) => {
        const memory = candidate.memory;
        if (memory.policySource === 'user') return true;
        if (memory.policySource !== 'auto' || candidate.sourceRole !== 'user') return false;
        return shouldPromoteToCore({
          memoryKey: memory.memoryKey,
          subject: memory.subject,
          memoryType: memory.memoryType,
          confidence: memory.confidence,
          scope: {
            scopeKind: memory.scopeKind || 'unassigned',
            spaceId: memory.spaceId ?? null,
            bindingRevision: scope.bindingRevision,
          },
          content: memory.content,
          userSourceText: candidate.sourceContent,
        });
      })
      .map(({ memory }) => memory);
  } catch {
    diagnostics.coreReadFailed = true;
    return [];
  }
}

function addContextSkipReasons(
  result: MemoryContextPackingResult,
  query: string | undefined,
  scope: MemoryScopeSnapshot,
  queryTokenCount: number,
  diagnostics: {
    ftsUnavailable: boolean;
    coreReadFailed: boolean;
    rawCandidateCount: number;
    relevantCandidateCount: number;
  },
): void {
  const skipped = result.observation.skipped;
  if (query?.trim() && queryTokenCount === 0) skipped.invalid_query = 1;
  if (scope.scopeKind === 'unassigned') skipped.unassigned_scope = 1;
  if (diagnostics.ftsUnavailable) skipped.fts_unavailable = 1;
  if (diagnostics.coreReadFailed) skipped.core_read_failed = 1;
  if (diagnostics.rawCandidateCount > diagnostics.relevantCandidateCount) {
    skipped.retrieval_filtered =
      (skipped.retrieval_filtered || 0) +
      diagnostics.rawCandidateCount -
      diagnostics.relevantCandidateCount;
  }
}

function recordSelectedAccess(result: MemoryContextPackingResult): void {
  const selectedIds = [
    ...result.observation.selectedCoreIds,
    ...result.observation.selectedRetrievalIds,
  ];
  if (selectedIds.length === 0) return;
  try {
    memoryRepo.withTransaction(() =>
      memoryRepo.recordAccess(selectedIds, new Date().toISOString()),
    );
  } catch {
    result.observation.skipped.access_update_failed = 1;
  }
}

function ensureMemorySearchIndex(): void {
  if (memorySearchRepo.getTokenizerVersion() === MEMORY_TOKENIZER_VERSION) {
    memorySearchRepo.verifyIndex();
    return;
  }
  const documents = memoryRepo
    .findAll()
    .filter((memory) => memory.scopeKind !== 'unassigned')
    .map(toMemorySearchDocument);
  memorySearchRepo.replaceAll(documents, MEMORY_TOKENIZER_VERSION);
  memorySearchRepo.verifyIndex();
}

/** Rebuild the versioned lexical projection before accepting memory retrieval work. */
export function initializeMemorySearchIndex(): void {
  ensureMemorySearchIndex();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isFiniteScore(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
  );
}

function isMemoryOperationAction(value: unknown): value is MemoryOperationAction {
  return value === 'ADD' || value === 'UPDATE' || value === 'NOOP' || value === 'DELETE';
}

function normalizeOperation(value: unknown): MemoryOperation | null {
  if (!isRecord(value) || !isMemoryOperationAction(value.action)) return null;
  if (
    typeof value.memoryKey !== 'string' ||
    value.memoryKey.trim().length === 0 ||
    value.memoryKey.trim().length > MAX_MEMORY_KEY_LENGTH
  )
    return null;
  if (!isValidTemporalRange(value.validFrom, value.validTo)) return null;
  if (
    value.subject !== undefined &&
    (typeof value.subject !== 'string' ||
      value.subject.trim().length === 0 ||
      value.subject.trim().length > MAX_MEMORY_SUBJECT_LENGTH)
  )
    return null;
  if (
    value.content !== undefined &&
    (typeof value.content !== 'string' || value.content.trim().length > MAX_MEMORY_CONTENT_LENGTH)
  )
    return null;
  if (
    value.category !== undefined &&
    (typeof value.category !== 'string' || value.category.trim().length > MAX_MEMORY_KEY_LENGTH)
  )
    return null;
  if (
    value.memoryType !== undefined &&
    (typeof value.memoryType !== 'string' || value.memoryType.trim().length > MAX_MEMORY_KEY_LENGTH)
  )
    return null;
  if (!isFiniteScore(value.confidence) || !isFiniteScore(value.importance)) return null;
  if (
    !isNullableString(value.relationship) ||
    !isNullableString(value.validFrom) ||
    !isNullableString(value.validTo) ||
    !isNullableString(value.sourceMessageId)
  )
    return null;

  const operation: MemoryOperation = {
    action: value.action,
    memoryKey: typeof value.memoryKey === 'string' ? value.memoryKey : undefined,
    subject: typeof value.subject === 'string' ? value.subject : undefined,
    relationship: value.relationship,
    value: value.value,
    content: typeof value.content === 'string' ? value.content : undefined,
    category: typeof value.category === 'string' ? value.category : undefined,
    memoryType: typeof value.memoryType === 'string' ? value.memoryType : undefined,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
    importance: typeof value.importance === 'number' ? value.importance : undefined,
    validFrom: value.validFrom,
    validTo: value.validTo,
    sourceMessageId: value.sourceMessageId,
  };
  if (operation.value !== undefined) {
    let serializedValue: string | undefined;
    try {
      serializedValue = JSON.stringify(operation.value);
    } catch {
      return null;
    }
    if (!serializedValue || serializedValue.length > MAX_MEMORY_VALUE_LENGTH) return null;
  }
  const content = operation.content || (typeof operation.value === 'string' ? operation.value : '');
  if (
    (operation.action === 'ADD' || operation.action === 'UPDATE') &&
    (content.trim().length === 0 || content.trim().length > MAX_MEMORY_CONTENT_LENGTH)
  )
    return null;
  return operation;
}

function isValidTemporalRange(validFrom: unknown, validTo: unknown): boolean {
  const from = validFrom === null || validFrom === undefined ? null : Date.parse(String(validFrom));
  const to = validTo === null || validTo === undefined ? null : Date.parse(String(validTo));
  return (
    (from === null || Number.isFinite(from)) &&
    (to === null || Number.isFinite(to)) &&
    (from === null || to === null || to > from)
  );
}

function clampScore(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

/** 将结构化记忆操作应用到 SQLite，并保留被替代事实。 */
export function applyMemoryOperations(
  operations: MemoryOperation[],
  sourceConversationId: string,
  jobId: string | null = null,
  scope: MemoryScopeSnapshot = {
    scopeKind: 'global',
    spaceId: null,
    bindingRevision: 0,
  },
): Memory[] {
  if (scope.scopeKind === 'unassigned') {
    throw new Error('Unassigned memories cannot be written by extraction');
  }
  return memoryRepo.withTransaction(() => {
    if (scope.scopeKind === 'space' && !memoryRepo.isMemorySpaceActive(scope.spaceId!)) {
      throw new Error('Memory space is unavailable');
    }
    const created: Memory[] = [];
    for (const operation of operations) {
      const next = applySingleMemoryOperation(operation, sourceConversationId, jobId, scope);
      if (next) created.push(next);
    }
    return created;
  });
}

/** Apply one already-normalized fact inside the caller's SQLite transaction. */
function applySingleMemoryOperation(
  operation: MemoryOperation,
  sourceConversationId: string,
  jobId: string | null,
  scope: MemoryScopeSnapshot,
): Memory | null {
  const action = operation.action;
  const memoryKey = operation.memoryKey?.trim() || 'general';
  const subject = operation.subject?.trim() || 'user';
  const content =
    operation.content?.trim() ||
    (typeof operation.value === 'string' ? operation.value.trim() : '');
  if (!isMemoryOperationAction(action)) return null;
  if (!isValidTemporalRange(operation.validFrom, operation.validTo)) {
    throw new Error('Memory operation has an invalid validity range');
  }

  const candidates = memoryRepo.findActiveByKey(
    memoryKey,
    subject,
    scope.scopeKind === 'space' ? 'space' : 'global',
    scope.spaceId,
  );
  const candidateIds = candidates.map((candidate) => candidate.id);
  const event = {
    id: uuidv4(),
    jobId,
    conversationId: sourceConversationId,
    sourceMessageId: operation.sourceMessageId,
    action,
    memoryKey,
    subject,
    candidateIds,
    scopeKind: scope.scopeKind,
    spaceId: scope.spaceId,
    bindingRevision: scope.bindingRevision,
  };
  if (action === 'NOOP') {
    memoryRepo.createEvent({ ...event, status: 'noop' });
    return null;
  }
  const same = action !== 'DELETE' && candidates.find((candidate) => candidate.content === content);
  if (same) {
    memoryRepo.createEvent({ ...event, resultMemoryId: same.id, status: 'noop' });
    return null;
  }
  if (candidates.some((candidate) => candidate.policySource === 'user')) {
    memoryRepo.createEvent({ ...event, status: 'noop', errorCode: 'user_policy_preserved' });
    return null;
  }
  if (action === 'DELETE') {
    for (const candidate of candidates) memoryRepo.update(candidate.id, { status: 'deleted' });
    memoryRepo.createEvent({ ...event, supersededIds: candidateIds, status: 'deleted' });
    return null;
  }
  if (!content) return null;
  const confidence = clampScore(operation.confidence, 0.8);
  const memoryType = operation.memoryType || 'semantic';
  const userSourceText = memoryRepo.findUserSourceText(operation.sourceMessageId);
  const contextPolicy =
    (operation.semanticDecision === undefined ||
      canonicalMemoryKey(operation.semanticDecision) !== null) &&
    shouldPromoteToCore({
      memoryKey,
      subject,
      memoryType,
      confidence,
      scope,
      content,
      userSourceText,
    })
      ? 'core'
      : 'retrievable';

  const next = memoryRepo.create({
    id: uuidv4(),
    content,
    category: operation.category || 'general',
    memoryKey,
    value: operation.value ?? content,
    memoryType,
    subject,
    relationship: operation.relationship || null,
    confidence,
    importance: clampScore(operation.importance, 0.6),
    validFrom: operation.validFrom || null,
    validTo: operation.validTo || null,
    supersedesId: action === 'UPDATE' ? candidates[0]?.id || null : null,
    sourceMessageId: operation.sourceMessageId || null,
    sourceConversationId,
    contextPolicy,
    policySource: 'auto',
    scopeKind: scope.scopeKind === 'space' ? 'space' : 'global',
    spaceId: scope.spaceId,
  });
  memorySearchRepo.upsertDocument(toMemorySearchDocument(next));
  const supersededIds = action === 'UPDATE' ? candidateIds : [];
  for (const candidate of candidates) {
    if (action === 'UPDATE') memoryRepo.supersede(candidate.id, next.id);
  }
  memoryRepo.createEvent({
    ...event,
    resultMemoryId: next.id,
    supersededIds,
    status: 'applied',
  });
  return next;
}

/** 记录不含原始错误正文的记忆处理失败摘要。 */
export function recordMemoryProcessingFailure(
  conversationId: string,
  jobId: string,
  errorCode: string,
  scope: MemoryScopeSnapshot = {
    scopeKind: 'unassigned',
    spaceId: null,
    bindingRevision: 0,
  },
): void {
  try {
    memoryRepo.createEvent({
      id: uuidv4(),
      jobId,
      conversationId,
      action: 'EXTRACTION',
      memoryKey: 'general',
      subject: 'user',
      status: 'failed',
      errorCode: errorCode || 'unknown_error',
      scopeKind: scope.scopeKind,
      spaceId: scope.spaceId,
      bindingRevision: scope.bindingRevision,
    });
  } catch {
    // 失败审计不能反过来阻塞任务状态更新。
  }
}

// ── 价值判断（v1.5.1） ──

// 原有启发式由 Memory domain 的 legacy gate provider 持有，
// 在这里再导出以保住既有调用方与测试的导入路径。
export { isConversationValuable } from '../../domains/memory/index.js';

/**
 * 记录一次记忆门控尝试，供实验稳定性统计。
 * 审计失败不能影响对话主流程，因此整体包在 try/catch 中。
 * @param resolution 门控结论
 * @param conversationId 会话 id
 * @param sourceMessageId 触发门控的助手消息 id
 */
export function recordMemoryGateOutcome(
  resolution: MemoryGateResolution,
  conversationId: string,
  sourceMessageId: string | null,
  scope: MemoryScopeSnapshot = {
    scopeKind: 'unassigned',
    spaceId: null,
    bindingRevision: 0,
  },
): void {
  try {
    const degraded = resolution.attempts.find((attempt) => attempt.outcome === 'unavailable');
    memoryRepo.createEvent({
      id: uuidv4(),
      jobId: null,
      conversationId,
      sourceMessageId,
      action: 'GATE',
      memoryKey: resolution.hint?.category ?? 'general',
      subject: 'user',
      status: degraded ? 'failed' : resolution.memorize ? 'applied' : 'noop',
      errorCode: degraded ? `jev_gate_${degraded.reason ?? 'unknown'}` : null,
      scopeKind: scope.scopeKind,
      spaceId: scope.spaceId,
      bindingRevision: scope.bindingRevision,
    });
  } catch {
    // 审计写入失败不应影响门控结果与对话。
  }
}

const MEMORY_EXTRACTION_PROMPT = `你是一个记忆提取助手。从以下对话中提取关于用户的重要信息，按分类输出。

分类标签：
[personal]    个人信息（名字、职业、地点、背景等）
[preference]  用户偏好（喜欢的风格、语言、主题、回答方式等）
[feedback]    行为反馈（用户的纠正、不满意、补充要求等）
[project]     项目信息（正在做的事、技术栈、业务领域等）
[goal]        目标意图（用户想达成的目标、学习计划等）
[general]     通用（其他值得记住的信息）

输出格式：优先返回 JSON，格式为：
{"operations":[{"action":"ADD|UPDATE|NOOP|DELETE","memoryKey":"personal.name","subject":"user","category":"personal","value":"事实值","content":"可读事实","confidence":0.9,"importance":0.7}]}

规则：
- sourceMessageId 必须填写支持该事实的 user 消息 ID；不要引用 assistant 消息，不得编造 ID
- 优先使用稳定的语义键；不要把项目技术栈、语言学习、临时旅行误认为职业、回答语言或时区
- 只提取确定的、跨对话有价值的信息
- 如果没有新信息，输出空
- UPDATE 用于修正同一 memoryKey 和 subject 的旧事实，NOOP 用于重复信息
- DELETE 只用于用户明确撤销或否定既有事实
- 无法确定主体、键或事实时不要猜测，返回空 operations`;

// ── 执行 AI 提取 ──

export async function performExtractionWithClient(
  settings: AiSettings,
  messages: MemoryExtractionMessage[],
  conversationId: string,
  extractionClient: MemoryExtractionClient,
  jobId: string | null = null,
  scope: MemoryScopeSnapshot = {
    scopeKind: 'global',
    spaceId: null,
    bindingRevision: 0,
  },
  shutdownSignal?: AbortSignal,
  semanticClassifier?: MemorySemanticClassifier,
): Promise<boolean> {
  if (!settings.memoryEnabled) return true;

  const { apiUrl, apiKey } = settings;
  if (!apiUrl || !apiKey) return true;

  const controller = new AbortController();
  const abortFromShutdown = () => controller.abort();
  shutdownSignal?.addEventListener('abort', abortFromShutdown, { once: true });
  if (shutdownSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), MEMORY_EXTRACTION_TIMEOUT_MS);
  const transcript = messages
    .map((message) => `[${message.createdAt}] ${message.role} (${message.id})：${message.content}`)
    .join('\n');

  try {
    controller.signal.throwIfAborted();
    const content = await extractionClient.complete(
      [
        { role: 'system', content: MEMORY_EXTRACTION_PROMPT },
        { role: 'user', content: transcript },
      ],
      { modelId: settings.modelId, apiType: settings.apiType || 'openai-chat' },
      apiUrl,
      apiKey,
      { maxTokens: 500, temperature: 0.3, signal: controller.signal },
    );

    controller.signal.throwIfAborted();

    if (!content || !content.trim()) return true;

    const parsedOperations = parseExtractionResponse(content, messages);
    if (parsedOperations.rejected) {
      memoryRepo.createEvent({
        id: uuidv4(),
        jobId,
        conversationId,
        action: 'EXTRACTION',
        memoryKey: 'general',
        subject: 'user',
        status: 'rejected',
        errorCode: 'memory_operation_schema_invalid',
      });
      return true;
    }
    await applyExtractedOperations(
      parsedOperations.operations,
      messages,
      conversationId,
      jobId,
      scope,
      controller.signal,
      semanticClassifier,
    );
    return true;
  } catch (err) {
    const errorCode =
      err instanceof Error && err.name === 'AbortError'
        ? 'extraction_timeout'
        : 'extraction_failed';
    console.error('[memory] extraction failed', { errorCode });
    return false;
  } finally {
    clearTimeout(timeout);
    shutdownSignal?.removeEventListener('abort', abortFromShutdown);
  }
}

/** Preserve legacy text extraction while keeping invalid structured output fail closed. */
function parseExtractionResponse(
  content: string,
  messages: MemoryExtractionMessage[],
): ParsedMemoryOperations {
  const parsed = parseMemoryOperations(content);
  if (parsed.isStructured) return parsed;
  const sourceMessageId = messages.find((message) => message.role === 'user')?.id || null;
  const operations = extractMemoriesFromResponse(content).map((entry) =>
    normalizeOperation({
      action: 'ADD',
      memoryKey: entry.category,
      subject: 'user',
      category: entry.category,
      content: entry.content,
      sourceMessageId,
    }),
  );
  return {
    isStructured: false,
    rejected: operations.some((operation) => operation === null),
    operations: operations.filter((operation): operation is MemoryOperation => operation !== null),
  };
}

/** Resolve keys outside the transaction and prohibit writes after cancellation. */
async function applyExtractedOperations(
  operations: MemoryOperation[],
  messages: MemoryExtractionMessage[],
  conversationId: string,
  jobId: string | null,
  scope: MemoryScopeSnapshot,
  signal: AbortSignal,
  classifier?: MemorySemanticClassifier,
): Promise<void> {
  const resolved = classifier
    ? await normalizeMemoryOperations(operations, messages, classifier, signal)
    : operations;
  signal.throwIfAborted();
  applyMemoryOperations(resolved, conversationId, jobId, scope);
}

/** 解析 LLM 返回的结构化记忆操作；格式不合法时安全返回空数组。 */
export function extractMemoryOperations(text: string): MemoryOperation[] {
  return parseMemoryOperations(text).operations;
}

interface ParsedMemoryOperations {
  isStructured: boolean;
  operations: MemoryOperation[];
  rejected: boolean;
}

/** 解析并校验结构化操作；结构化响应一旦非法不得降级为写入。 */
function parseMemoryOperations(text: string): ParsedMemoryOperations {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const isStructured = normalized.startsWith('{');
  if (!isStructured) return { isStructured: false, operations: [], rejected: false };
  try {
    const parsed: unknown = JSON.parse(normalized);
    if (!isRecord(parsed) || !Array.isArray(parsed.operations))
      return { isStructured: true, operations: [], rejected: true };
    const operations = parsed.operations.map(normalizeOperation);
    if (operations.some((operation) => operation === null))
      return { isStructured: true, operations: [], rejected: true };
    return {
      isStructured: true,
      operations: operations.filter(
        (operation): operation is MemoryOperation => operation !== null,
      ),
      rejected: false,
    };
  } catch {
    return { isStructured: true, operations: [], rejected: true };
  }
}

// ── 解析 LLM 响应 ──

export function extractMemoriesFromResponse(text: string): { category: string; content: string }[] {
  const lines = text.split('\n');
  const results: { category: string; content: string }[] = [];
  const regex = /^\[(\w+)\]\s+(.+)$/;
  const validCategories = new Set(CATEGORY_ORDER);

  for (const line of lines) {
    const match = line.trim().match(regex);
    if (!match) continue;
    const category = match[1];
    const content = match[2].trim();
    if (validCategories.has(category) && content) {
      results.push({ category, content });
    }
  }

  return results;
}
