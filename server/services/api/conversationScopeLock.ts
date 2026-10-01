import { agentRunRegistry } from '../agentRun.js';

const reservedConversations = new Set<string>();

/** Reserve a conversation against memory-scope changes during an active chat invocation. */
export function reserveConversationScope(conversationId: string): () => void {
  if (
    reservedConversations.has(conversationId) ||
    agentRunRegistry.getByConversation(conversationId)
  ) {
    throw Object.assign(new Error('Conversation has an active run'), { status: 409 });
  }
  reservedConversations.add(conversationId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reservedConversations.delete(conversationId);
  };
}

/** Check both request-time reservations and durable active runs for UI busy state. */
export function isConversationScopeBusy(conversationId: string): boolean {
  return (
    reservedConversations.has(conversationId) ||
    Boolean(agentRunRegistry.getByConversation(conversationId))
  );
}
