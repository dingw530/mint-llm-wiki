import { afterEach, describe, expect, it } from 'vitest';
import { agentRunRegistry, AgentRun } from '../../agentRun.js';
import { isConversationScopeBusy, reserveConversationScope } from '../conversationScopeLock.js';

afterEach(() => agentRunRegistry.clear());

describe('conversation scope lock', () => {
  it('serializes a chat scope snapshot with binding updates', () => {
    const release = reserveConversationScope('conversation-a');
    expect(isConversationScopeBusy('conversation-a')).toBe(true);
    expect(() => reserveConversationScope('conversation-a')).toThrow(
      'Conversation has an active run',
    );
    release();
    expect(isConversationScopeBusy('conversation-a')).toBe(false);
    expect(() => reserveConversationScope('conversation-a')).not.toThrow();
  });

  it('respects a durable run that remains active after its request handler returns', () => {
    agentRunRegistry.register(
      new AgentRun({ runId: 'paused-run', conversationId: 'conversation-a' }),
    );
    expect(isConversationScopeBusy('conversation-a')).toBe(true);
    expect(() => reserveConversationScope('conversation-a')).toThrow(
      'Conversation has an active run',
    );
  });
});
