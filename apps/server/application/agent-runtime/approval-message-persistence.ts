import * as messageRepository from '../../repositories/messageRepository.js';
import { v4 as uuidv4 } from 'uuid';

/** Persists a non-empty assistant continuation produced after an approved tool call. */
export function persistApprovalContinuation(
  conversationId: string,
  content: string,
  reasoning: string,
): void {
  if (!content) return;
  messageRepository.create({
    id: uuidv4(),
    conversationId,
    role: 'assistant',
    content,
    reasoning: reasoning || null,
    createdAt: new Date().toISOString(),
  });
}
