import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { matchesReactRun } from '../MessageList';

describe('MessageList ReAct run matching', () => {
  it('only matches the assistant message from the current run', () => {
    const previousMessage = { role: 'assistant', content: 'old', runId: 'run-old' } as Message;
    const currentMessage = { role: 'assistant', content: 'current', runId: 'run-current' } as Message;

    expect(matchesReactRun(previousMessage, 'run-current')).toBe(false);
    expect(matchesReactRun(currentMessage, 'run-current')).toBe(true);
  });
});
