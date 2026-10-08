import type { Memory, MemoryContextPolicy, MemoryScopeKind, MemorySpace } from '@/types';
import { callEndpoint } from '../api/_base';

export function getMemories(
  category?: string,
  scopeKind?: MemoryScopeKind,
  spaceId?: string,
  contextPolicy?: MemoryContextPolicy,
  includeUnassigned?: boolean,
  includeInactive?: boolean,
): Promise<Memory[]> {
  return callEndpoint('memories:list', {
    category,
    scopeKind,
    spaceId,
    contextPolicy,
    includeUnassigned,
    includeInactive,
  });
}

export function createMemory(data: Partial<Memory>): Promise<Memory> {
  return callEndpoint('memories:create', data);
}

export function updateMemory(id: string, data: Partial<Memory>): Promise<Memory> {
  return callEndpoint('memories:update', id, data);
}

export function deleteMemory(id: string): Promise<{ success: boolean }> {
  return callEndpoint('memories:delete', id);
}

export function assignMemoryScope(data: {
  ids: string[];
  scopeKind: 'global' | 'space';
  spaceId: string | null;
}): Promise<{ updated: number }> {
  return callEndpoint('memories:assignScope', data);
}

export function getMemorySpaces(includeArchived = false): Promise<{ spaces: MemorySpace[] }> {
  return callEndpoint('memory-spaces:list', String(includeArchived));
}

export function createMemorySpace(data: { name: string }): Promise<{ space: MemorySpace }> {
  return callEndpoint('memory-spaces:create', data);
}

export function updateMemorySpace(
  id: string,
  data: { name?: string; archived?: boolean },
): Promise<{ space: MemorySpace }> {
  return callEndpoint('memory-spaces:update', id, data);
}
