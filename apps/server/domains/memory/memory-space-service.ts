import type { MemoryScopeRepositoryPort } from './ports.js';
import type { MemoryScopeSnapshot } from './types.js';
import * as memoryRepository from '../../infrastructure/persistence/memory-repository.js';
import * as memorySearchRepository from '../../infrastructure/persistence/memory-search-repository.js';
import { MEMORY_TOKENIZER_VERSION, toMemorySearchDocument } from './memory-query.js';

/** Build validated knowledge-space and conversation-scope use cases. */
export function createMemorySpaceService(repository: MemoryScopeRepositoryPort) {
  return {
    listSpaces: (includeArchived = false) => repository.listSpaces(includeArchived),
    createSpace: (name: string) => repository.createSpace(name),
    renameSpace: (id: string, name: string) => repository.renameSpace(id, name),
    archiveSpace: (id: string) => repository.archiveSpace(id),
    getConversationScope: (conversationId: string) =>
      repository.findConversationScope(conversationId),
    bindConversation: (conversationId: string, spaceId: string | null) =>
      repository.bindConversation(conversationId, spaceId),
    listBoundConversationIds: (spaceId: string) => repository.listBoundConversationIds(spaceId),
    captureMessageScope: (messageId: string, conversationId: string, scope: MemoryScopeSnapshot) =>
      repository.captureMessageScope(messageId, conversationId, scope),
    getMessageScope: (messageId: string) => repository.findMessageScope(messageId),
    assignMemories: (memoryIds: string[], scopeKind: 'global' | 'space', spaceId: string | null) =>
      memoryRepository.withTransaction(() => {
        const uniqueIds = [...new Set(memoryIds)];
        const memories = memoryRepository.findByIds(uniqueIds);
        if (memories.length !== uniqueIds.length) {
          throw new Error('One or more memories were not found');
        }
        if (memorySearchRepository.getTokenizerVersion() !== MEMORY_TOKENIZER_VERSION) {
          throw new Error('Memory search index must be initialized before scope assignment');
        }
        const result = repository.assignMemoryScope(uniqueIds, scopeKind, spaceId);
        for (const memory of memories) {
          memorySearchRepository.upsertDocument(toMemorySearchDocument(memory));
        }
        return result;
      }),
  };
}
