import type { Conversation, Message } from '@/types';
import { callEndpoint, ipcOrHttp, request, getElectronAPI } from '../api/_base';

export function getConversations(type?: string): Promise<{ conversations: Conversation[] }> {
  return ipcOrHttp(
    () => getElectronAPI()!.getConversations(type),
    () => request(`/conversations${type ? `?type=${type}` : ''}`),
  );
}

export function createConversation(
  title?: string,
  type?: string,
): Promise<{ conversation: Conversation }> {
  return ipcOrHttp(
    () => getElectronAPI()!.createConversation(title, type),
    () => request('/conversations', { method: 'POST', body: JSON.stringify({ title, type }) }),
  );
}

export function deleteConversation(id: string): Promise<{ success: boolean }> {
  return ipcOrHttp(
    () => getElectronAPI()!.deleteConversation(id),
    () => request(`/conversations/${id}`, { method: 'DELETE' }),
  );
}

export function clearAllConversations(): Promise<{ changes: number }> {
  return ipcOrHttp(
    () => getElectronAPI()!.clearAllConversations(),
    () => request('/conversations', { method: 'DELETE' }),
  );
}

export function renameConversation(
  id: string,
  title: string,
): Promise<{ conversation: Conversation }> {
  return ipcOrHttp(
    () => getElectronAPI()!.renameConversation(id, title),
    () => request(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  );
}

export function lockAgent(
  conversationId: string,
  agentId: string | null,
): Promise<{ conversation: Conversation }> {
  return ipcOrHttp(
    () => getElectronAPI()!.lockAgent(conversationId, agentId),
    () =>
      request(`/conversations/${conversationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ lockedAgent: agentId }),
      }),
  );
}

export function unlockAgent(conversationId: string): Promise<{ conversation: Conversation }> {
  return lockAgent(conversationId, null);
}

export function getConversationMemorySpace(conversationId: string) {
  return callEndpoint<{
    conversationId: string;
    memorySpaceId: string | null;
    memoryBindingRevision: number;
    scopeKind: 'global' | 'space' | 'unassigned';
  }>('conversations:getMemorySpace', conversationId);
}

export function setConversationMemorySpace(conversationId: string, spaceId: string | null) {
  return callEndpoint<{
    conversationId: string;
    memorySpaceId: string | null;
    memoryBindingRevision: number;
    changed: boolean;
  }>('conversations:setMemorySpace', conversationId, { spaceId });
}

export function getMessages(conversationId: string): Promise<{ messages: Message[] }> {
  return ipcOrHttp(
    () => getElectronAPI()!.getMessages(conversationId),
    () => request(`/conversations/${conversationId}/messages`),
  );
}

export function generateTitle(conversationId: string): Promise<{ title: string }> {
  return ipcOrHttp(
    () => getElectronAPI()!.generateTitle(conversationId),
    () => request(`/conversations/${conversationId}/generate-title`, { method: 'POST' }),
  );
}
