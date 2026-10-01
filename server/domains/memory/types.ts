import type { MemorySemanticDecision } from './memorySemanticPolicy.js';
export type MemoryStatus = 'active' | 'superseded' | 'deleted';
export type MemoryType = 'semantic' | 'episodic' | 'procedural';
export type MemoryOperationAction = 'ADD' | 'UPDATE' | 'NOOP' | 'DELETE';
export type MemoryScopeKind = 'global' | 'space' | 'unassigned';
export type MemoryContextPolicy = 'core' | 'retrievable';
export type MemoryPolicySource = 'user' | 'auto' | 'migration';

export interface MemoryScopeSnapshot {
  scopeKind: 'global' | 'space' | 'unassigned';
  spaceId: string | null;
  bindingRevision: number;
}

export interface MemorySpace {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryListFilters {
  category?: string;
  scopeKind?: MemoryScopeKind;
  spaceId?: string;
  contextPolicy?: MemoryContextPolicy;
  includeUnassigned?: boolean;
  includeInactive?: boolean;
}

export interface MemoryMessageScope extends MemoryScopeSnapshot {
  messageId: string;
  conversationId: string;
  capturedAt: string;
}

export interface MemoryCoreCandidate {
  memory: Memory;
  sourceRole: string | null;
  sourceContent: string | null;
}

export interface Memory {
  id: string;
  content: string;
  category: string;
  memoryKey: string;
  value: unknown;
  memoryType: MemoryType | string;
  subject: string;
  relationship: string | null;
  confidence: number;
  importance: number;
  validFrom: string | null;
  validTo: string | null;
  status: MemoryStatus | string;
  supersedesId: string | null;
  sourceMessageId: string | null;
  sourceCreatedAt?: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
  contextPolicy?: MemoryContextPolicy;
  policySource?: MemoryPolicySource;
  scopeKind?: MemoryScopeKind;
  spaceId?: string | null;
}

export interface CreateMemoryParams {
  id: string;
  content: string;
  category?: string;
  memoryKey?: string;
  value?: unknown;
  memoryType?: MemoryType | string;
  subject?: string;
  relationship?: string | null;
  confidence?: number;
  importance?: number;
  validFrom?: string | null;
  validTo?: string | null;
  status?: MemoryStatus | string;
  supersedesId?: string | null;
  sourceMessageId?: string | null;
  sourceConversationId?: string | null;
  contextPolicy?: MemoryContextPolicy;
  policySource?: MemoryPolicySource;
  scopeKind?: MemoryScopeKind;
  spaceId?: string | null;
}

export interface UpdateMemoryParams {
  content?: string;
  category?: string;
  memoryKey?: string;
  value?: unknown;
  memoryType?: MemoryType | string;
  subject?: string;
  relationship?: string | null;
  confidence?: number;
  importance?: number;
  validFrom?: string | null;
  validTo?: string | null;
  status?: MemoryStatus | string;
  supersedesId?: string | null;
  sourceMessageId?: string | null;
  contextPolicy?: MemoryContextPolicy;
  policySource?: MemoryPolicySource;
  scopeKind?: MemoryScopeKind;
  spaceId?: string | null;
}

export interface MemoryExtractionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface MemoryOperation {
  /** Domain-only metadata; never accepted from the extraction JSON. */
  semanticDecision?: MemorySemanticDecision;
  action: MemoryOperationAction;
  memoryKey?: string;
  subject?: string;
  relationship?: string | null;
  value?: unknown;
  content?: string;
  category?: string;
  memoryType?: string;
  confidence?: number;
  importance?: number;
  validFrom?: string | null;
  validTo?: string | null;
  sourceMessageId?: string | null;
}

export interface MemoryEventInput {
  id: string;
  jobId?: string | null;
  conversationId?: string | null;
  scopeKind?: MemoryScopeSnapshot['scopeKind'];
  spaceId?: string | null;
  bindingRevision?: number;
  sourceMessageId?: string | null;
  action: string;
  memoryKey: string;
  subject: string;
  candidateIds?: string[];
  resultMemoryId?: string | null;
  supersededIds?: string[];
  status: 'applied' | 'noop' | 'deleted' | 'rejected' | 'failed';
  errorCode?: string | null;
}

export interface MemoryEventRecord {
  id: string;
  jobId: string | null;
  conversationId: string | null;
  scopeKind?: MemoryScopeSnapshot['scopeKind'];
  spaceId?: string | null;
  bindingRevision?: number;
  sourceMessageId: string | null;
  action: string;
  memoryKey: string;
  subject: string;
  candidateIds: string[];
  resultMemoryId: string | null;
  supersededIds: string[];
  status: MemoryEventInput['status'];
  errorCode: string | null;
  createdAt: string;
}

export interface MemoryJob {
  id: string;
  conversationId: string;
  scopeKind: MemoryScopeSnapshot['scopeKind'];
  spaceId: string | null;
  bindingRevision: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  availableAt: string;
  lockedAt: string | null;
  requestedThroughMessageId: string | null;
  processedThroughMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MemoryJobRow = {
  id: string;
  conversation_id: string;
  scope_kind: MemoryScopeSnapshot['scopeKind'];
  space_id: string | null;
  binding_revision: number;
  status: MemoryJob['status'];
  attempts: number;
  available_at: string;
  locked_at: string | null;
  requested_through_message_id: string | null;
  processed_through_message_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
