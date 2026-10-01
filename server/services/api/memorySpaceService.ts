import { createMemorySpaceService } from '../../domains/memory/index.js';
import type { MemoryScopeKind } from '../../domains/memory/index.js';
import * as memoryScopeRepository from '../../infrastructure/persistence/memoryScopeRepository.js';
import { isConversationScopeBusy, reserveConversationScope } from './conversationScopeLock.js';

const memorySpaces = createMemorySpaceService(memoryScopeRepository);

/** Return active or archived knowledge spaces for the management surface. */
export function listMemorySpaces(includeArchived = false) {
  return { spaces: memorySpaces.listSpaces(includeArchived) };
}

/** Create a knowledge space after validating the user-provided name. */
export function createMemorySpace(data: Record<string, unknown>) {
  if (typeof data.name !== 'string') throw httpError(400, 'Memory space name is required');
  try {
    return { space: memorySpaces.createSpace(data.name) };
  } catch (error) {
    throw httpError(400, error instanceof Error ? error.message : 'Invalid memory space name');
  }
}

/** Rename or archive a knowledge space. Archive unbinds its conversations atomically. */
export function updateMemorySpace(id: string, data: Record<string, unknown>) {
  if (data.archived === true) return archiveMemorySpace(id);
  if (typeof data.name !== 'string') throw httpError(400, 'Memory space name is required');
  try {
    const space = memorySpaces.renameSpace(id, data.name);
    if (!space) throw httpError(404, 'Memory space not found');
    return { space };
  } catch (error) {
    if (isHttpError(error)) throw error;
    throw httpError(400, error instanceof Error ? error.message : 'Invalid memory space name');
  }
}

/** Archive a space only after reserving every bound conversation against an active run. */
export function archiveMemorySpace(id: string) {
  const conversationIds = memorySpaces.listBoundConversationIds(id);
  return withConversationReservations(conversationIds, () => {
    const space = memorySpaces.archiveSpace(id);
    if (!space) throw httpError(404, 'Memory space not found');
    return { space };
  });
}

/** Bind or unbind one conversation while preserving the run-start scope snapshot. */
export function setConversationMemorySpace(conversationId: string, data: Record<string, unknown>) {
  if (!Object.hasOwn(data, 'spaceId')) throw httpError(400, 'spaceId must be provided');
  if (data.spaceId !== null && (typeof data.spaceId !== 'string' || !data.spaceId.trim())) {
    throw httpError(400, 'spaceId must be a non-empty id or null');
  }
  return withConversationReservations([conversationId], () => {
    try {
      const result = memorySpaces.bindConversation(conversationId, data.spaceId as string | null);
      if (!result) throw httpError(404, 'Conversation not found');
      return {
        conversationId,
        memorySpaceId: result.scope.spaceId,
        memoryBindingRevision: result.scope.bindingRevision,
        changed: result.changed,
      };
    } catch (error) {
      if (isHttpError(error)) throw error;
      throw httpError(404, 'Memory space or conversation not found');
    }
  });
}

/** Read the current durable memory binding using the scope-only persistence interface. */
export function getConversationMemorySpace(conversationId: string) {
  const scope = memorySpaces.getConversationScope(conversationId);
  if (!scope) throw httpError(404, 'Conversation not found');
  return {
    conversationId,
    memorySpaceId: scope.spaceId,
    memoryBindingRevision: scope.bindingRevision,
    scopeKind: scope.scopeKind,
  };
}

/** Assign an entire memory selection to global or one active space in a single transaction. */
export function assignMemoryScope(data: Record<string, unknown>) {
  if (
    !Array.isArray(data.ids) ||
    data.ids.length === 0 ||
    data.ids.length > 500 ||
    data.ids.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    throw httpError(400, 'ids must contain between 1 and 500 memory ids');
  }
  if (data.scopeKind !== 'global' && data.scopeKind !== 'space') {
    throw httpError(400, 'scopeKind must be global or space');
  }
  if (
    (data.scopeKind === 'global' && data.spaceId !== null) ||
    (data.scopeKind === 'space' && (typeof data.spaceId !== 'string' || !data.spaceId.trim()))
  ) {
    throw httpError(400, 'spaceId must match the requested scopeKind');
  }
  try {
    return memorySpaces.assignMemories(
      data.ids as string[],
      data.scopeKind as Extract<MemoryScopeKind, 'global' | 'space'>,
      data.spaceId as string | null,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'MemoryScopeConflictError') {
      throw httpError(409, 'Memory scope assignment conflicts with an existing single-value fact');
    }
    if (error instanceof Error && error.message === 'Memory space is unavailable') {
      throw httpError(404, error.message);
    }
    if (isHttpError(error)) throw error;
    throw error;
  }
}

function withConversationReservations<T>(conversationIds: string[], operation: () => T): T {
  const releases: Array<() => void> = [];
  try {
    for (const conversationId of [...new Set(conversationIds)].sort()) {
      if (isConversationScopeBusy(conversationId)) {
        throw httpError(409, 'Conversation has an active run');
      }
      releases.push(reserveConversationScope(conversationId));
    }
    return operation();
  } finally {
    for (const release of releases.reverse()) release();
  }
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isHttpError(error: unknown): error is Error & { status: number } {
  return error instanceof Error && 'status' in error;
}
