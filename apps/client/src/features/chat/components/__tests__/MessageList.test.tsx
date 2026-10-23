import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { getMessageSegments, matchesReactRun } from '../MessageList';

describe('MessageList ReAct run matching', () => {
  it('only matches the assistant message from the current run', () => {
    const previousMessage = { role: 'assistant', content: 'old', runId: 'run-old' } as Message;
    const currentMessage = {
      role: 'assistant',
      content: 'current',
      runId: 'run-current',
    } as Message;

    expect(matchesReactRun(previousMessage, 'run-current')).toBe(false);
    expect(matchesReactRun(currentMessage, 'run-current')).toBe(true);
  });

  it('restores persisted A2UI source blocks alongside existing Session segments', () => {
    const message: Message = {
      id: 'assistant-final',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'Alpha. [C1] Omega.',
      createdAt: '2026-10-21T00:00:00.000Z',
      segments: [
        { type: 'thinking', content: 'I checked the sources.' },
        { type: 'text', content: 'Alpha. [C1] Omega.' },
      ],
      uiBlocks: [
        {
          id: 'source-block-1',
          messageId: 'assistant-final',
          blockIndex: 0,
          textOffset: 7,
          kind: 'wiki_source_reference',
          version: 1,
          data: {
            refId: 'C1',
            title: 'Architecture',
            file: 'architecture.md',
            heading: 'Overview',
            snippet: 'Source excerpt',
            chunkId: 'architecture.md#chunk:0',
            textOffset: 7,
          },
          createdAt: '2026-10-21T00:00:00.000Z',
          updatedAt: '2026-10-21T00:00:00.000Z',
        },
      ],
    };

    const segments = getMessageSegments(message);

    expect(segments.map((segment) => segment.type)).toEqual(['thinking', 'text', 'a2ui', 'text']);
    expect(segments[2]).toMatchObject({
      type: 'a2ui',
      segmentId: 'persisted-source-block-1',
    });
  });
});
