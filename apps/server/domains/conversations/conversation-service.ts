import { v4 as uuidv4 } from 'uuid';
import * as conversationRepo from '../../infrastructure/persistence/conversation-repository.js';
import { getConversationRoutingMode } from '../../infrastructure/config/conversation-defaults.js';
import type { Conversation, HttpError } from '../../types.js';

const DEFAULT_ROUTING_MODE = 'auto';
const DEFAULT_TITLE = 'New Chat';

function getSettingsRoutingMode(): string {
  return getConversationRoutingMode() || DEFAULT_ROUTING_MODE;
}

export function list(type?: string) {
  return conversationRepo.findAll(type);
}

export function create({ title, type }: { title?: string; type?: string } = {}) {
  const id = uuidv4();
  const routingMode = getSettingsRoutingMode();
  return conversationRepo.create({ id, title: title || DEFAULT_TITLE, type, routingMode });
}

// 清空所有会话
export function removeAll() {
  return conversationRepo.deleteAll();
}

// 删除会话，不存在时抛出 404 错误
export function remove(id: string) {
  const result = conversationRepo.deleteById(id);
  if (result.changes === 0) {
    const err: HttpError = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }
  return { success: true };
}

// 重命名会话，校验标题非空
export function rename(id: string, title: string) {
  if (!title) {
    const err: HttpError = new Error('Title is required');
    err.status = 400;
    throw err;
  }
  const updated = conversationRepo.updateTitle(id, title);
  if (!updated) {
    const err: HttpError = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }
  return updated;
}

// 锁定/解锁 Agent
export function setLockedAgent(id: string, lockedAgent: string | null) {
  const updated = conversationRepo.updateLockedAgent(id, lockedAgent);
  if (!updated) {
    const err: HttpError = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }
  return updated;
}

/**
 * Read conversation metadata for request setup, preserving nullable lookup semantics.
 * @param id Conversation identifier
 * @returns Stored conversation, or null when it no longer exists
 */
export function findById(id: string): Conversation | null {
  return conversationRepo.findById(id);
}
