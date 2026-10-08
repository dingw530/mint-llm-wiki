import { v4 as uuidv4 } from 'uuid';
import * as memoryService from '../../domains/memory/index.js';
import * as memorySpaceService from '../../application/memory/memory-space-service.js';
import type { EndpointDescriptor } from '../types.js';

function listManagedMemories(query: Record<string, unknown> = {}) {
  const readString = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return String(value);
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value.at(-1);
    }
    return undefined;
  };
  const category = readString(query.category);
  const scopeKind = readString(query.scopeKind);
  const spaceId = readString(query.spaceId);
  const contextPolicy = readString(query.contextPolicy);
  const includeUnassigned = readString(query.includeUnassigned);
  const includeInactive = readString(query.includeInactive);
  if (
    includeUnassigned !== undefined &&
    includeUnassigned !== 'true' &&
    includeUnassigned !== 'false'
  ) {
    throw Object.assign(new Error('includeUnassigned must be true or false'), { status: 400 });
  }
  if (includeInactive !== undefined && includeInactive !== 'true' && includeInactive !== 'false') {
    throw Object.assign(new Error('includeInactive must be true or false'), { status: 400 });
  }
  return memoryService.listManagedMemories({
    category,
    scopeKind: scopeKind as 'global' | 'space' | 'unassigned' | undefined,
    spaceId,
    contextPolicy: contextPolicy as 'core' | 'retrievable' | undefined,
    includeUnassigned: includeUnassigned === 'true',
    includeInactive: includeInactive === 'true',
  });
}

export const memoriesEndpoints: EndpointDescriptor[] = [
  {
    id: 'memories:list',
    method: 'GET',
    path: '/',
    preloadMethod: 'getMemories',
    service: listManagedMemories,
    args: [{ from: 'query' }],
    result: 'direct',
  },
  {
    id: 'memories:create',
    method: 'POST',
    path: '/',
    preloadMethod: 'createMemory',
    service: (data: Record<string, unknown>) => {
      const content = data.content as string | undefined;
      if (
        content === undefined ||
        content === null ||
        (typeof content === 'string' && !content.trim())
      ) {
        throw Object.assign(new Error('内容不能为空'), { status: 400 });
      }
      return memoryService.createMemory({
        id: uuidv4(),
        content,
        category: (data.category as string) || 'general',
        memoryKey: data.memoryKey as string | undefined,
        subject: data.subject as string | undefined,
        contextPolicy: data.contextPolicy as 'core' | 'retrievable' | undefined,
        scopeKind: data.scopeKind as 'global' | 'space' | undefined,
        spaceId: data.spaceId as string | null | undefined,
        validFrom: data.validFrom as string | null | undefined,
        validTo: data.validTo as string | null | undefined,
        sourceConversationId: (data.sourceConversationId as string) || null,
      });
    },
    args: [{ from: 'body' }],
    result: 'direct',
  },
  {
    id: 'memories:update',
    method: 'PUT',
    path: '/:id',
    preloadMethod: 'updateMemory',
    service: (id: string, data: Record<string, unknown>) => {
      const result = memoryService.updateMemory(id, {
        content: data.content as string | undefined,
        category: data.category as string | undefined,
        memoryKey: data.memoryKey as string | undefined,
        subject: data.subject as string | undefined,
        contextPolicy: data.contextPolicy as 'core' | 'retrievable' | undefined,
        validFrom: data.validFrom as string | null | undefined,
        validTo: data.validTo as string | null | undefined,
      });
      if (!result) {
        throw Object.assign(new Error('记忆不存在'), { status: 404 });
      }
      return result;
    },
    args: [{ from: 'path', name: 'id' }, { from: 'body' }],
    result: 'direct',
  },
  {
    id: 'memories:delete',
    method: 'DELETE',
    path: '/:id',
    preloadMethod: 'deleteMemory',
    service: (id: string) => {
      memoryService.deleteMemory(id);
      return { success: true };
    },
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'memories:assignScope',
    method: 'POST',
    path: '/assign-scope',
    preloadMethod: 'assignMemoryScope',
    service: memorySpaceService.assignMemoryScope,
    args: [{ from: 'body', name: '' }],
    result: 'direct',
  },
  {
    id: 'memory-spaces:list',
    method: 'GET',
    path: '/',
    preloadMethod: 'getMemorySpaces',
    service: (includeArchived?: string) => {
      if (
        includeArchived !== undefined &&
        includeArchived !== 'true' &&
        includeArchived !== 'false'
      ) {
        throw Object.assign(new Error('includeArchived must be true or false'), { status: 400 });
      }
      return memorySpaceService.listMemorySpaces(includeArchived === 'true');
    },
    args: [{ from: 'query', name: 'includeArchived', optional: true }],
    result: 'direct',
  },
  {
    id: 'memory-spaces:create',
    method: 'POST',
    path: '/',
    preloadMethod: 'createMemorySpace',
    service: memorySpaceService.createMemorySpace,
    args: [{ from: 'body', name: '' }],
    result: 'direct',
  },
  {
    id: 'memory-spaces:update',
    method: 'PATCH',
    path: '/:id',
    preloadMethod: 'updateMemorySpace',
    service: memorySpaceService.updateMemorySpace,
    args: [
      { from: 'path', name: 'id' },
      { from: 'body', name: '' },
    ],
    result: 'direct',
  },
];
