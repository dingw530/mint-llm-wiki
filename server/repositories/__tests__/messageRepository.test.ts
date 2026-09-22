import { afterAll, describe, expect, it } from 'vitest';

import * as conversationRepo from '../conversationRepository.js';
import * as messageRepo from '../messageRepository.js';
import { v4 as uuidv4 } from 'uuid';

describe('messageRepository', () => {
  const convId = uuidv4();

  afterAll(() => {
    try {
      conversationRepo.deleteById(convId);
    } catch {}
  });

  it('creates and retrieves a message', () => {
    conversationRepo.create({ id: convId, title: 'test-msgs' });

    messageRepo.create({
      id: 'msg-test-1',
      conversationId: convId,
      role: 'user',
      content: 'hello',
      createdAt: new Date().toISOString(),
    });

    const msgs = messageRepo.findByConversationId(convId);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].id).toBe('msg-test-1');
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hello');
  });

  it('gets history without createdAt fields', () => {
    messageRepo.create({
      id: 'msg-test-2',
      conversationId: convId,
      role: 'assistant',
      content: 'response',
      reasoning: 'thinking...',
      createdAt: new Date().toISOString(),
    });

    const history = messageRepo.getHistory(convId);
    const assistantMsg = history.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe('response');
    expect(assistantMsg!.reasoning).toBe('thinking...');
  });

  it('updates conversation timestamp', () => {
    const now = new Date().toISOString();
    messageRepo.updateConversationTimestamp(convId, now);
    const conv = conversationRepo.findById(convId);
    expect(conv).not.toBeNull();
    expect(conv!.updatedAt).toBe(now);
  });

  it('returns empty for non-existent conversation', () => {
    const msgs = messageRepo.findByConversationId('nonexistent');
    expect(msgs).toEqual([]);
  });
});
