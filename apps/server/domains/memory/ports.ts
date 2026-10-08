export interface MemoryCompletionMessage {
  role: 'system' | 'user';
  content: string;
}

export interface MemoryCompletionSettings {
  modelId: string;
  apiType: string;
}

export interface MemoryCompletionOptions {
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export interface MemoryExtractionClient {
  complete(
    messages: MemoryCompletionMessage[],
    settings: MemoryCompletionSettings,
    apiUrl: string,
    apiKey: string,
    options: MemoryCompletionOptions,
  ): Promise<string | null>;
}

export interface MemoryScopeRepositoryPort {
  listSpaces(includeArchived?: boolean): MemorySpace[];
  createSpace(name: string): MemorySpace;
  renameSpace(id: string, name: string): MemorySpace | null;
  archiveSpace(id: string): MemorySpace | null;
  findConversationScope(conversationId: string): MemoryScopeSnapshot | null;
  bindConversation(
    conversationId: string,
    spaceId: string | null,
  ): { scope: MemoryScopeSnapshot; changed: boolean } | null;
  listBoundConversationIds(spaceId: string): string[];
  captureMessageScope(messageId: string, conversationId: string, scope: MemoryScopeSnapshot): void;
  findMessageScope(messageId: string): MemoryMessageScope | null;
  assignMemoryScope(
    memoryIds: string[],
    scopeKind: 'global' | 'space',
    spaceId: string | null,
  ): { updated: number };
}
import type { MemoryMessageScope, MemoryScopeSnapshot, MemorySpace } from './types.js';
