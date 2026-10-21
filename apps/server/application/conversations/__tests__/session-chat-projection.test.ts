import { describe, expect, it } from 'vitest';
import type { SessionEvent, SessionEventBase } from '@mint/session';
import { projectSessionChatMessages } from '../session-chat-projection.js';

describe('projectSessionChatMessages', () => {
  it('rebuilds user, assistant, tool result and final answer from Session events', () => {
    const events: SessionEvent[] = [
      {
        ...base(1),
        type: 'user_message',
        messageId: 'user-1',
        content: 'write a file',
      },
      {
        ...base(2),
        type: 'model_message',
        round: 1,
        messages: [
          {
            role: 'assistant',
            reasoning_content: 'I will inspect and write the file.',
            tool_calls: [
              {
                id: 'call-1',
                function: { name: 'write_file', arguments: '{"path":"a.txt"}' },
              },
            ],
          },
        ],
      },
      {
        ...base(3),
        type: 'tool_result',
        round: 1,
        callId: 'call-1',
        toolName: 'write_file',
        dispatchCommitted: true,
        status: 'success',
        message: { role: 'tool', content: 'file written' },
      },
      {
        ...base(4),
        type: 'model_message',
        round: 2,
        messages: [{ role: 'assistant', reasoning: 'The write completed; now I will verify it.' }],
      },
      {
        ...base(5),
        type: 'model_message',
        round: 3,
        messageId: 'assistant-final',
        messages: [{ role: 'assistant', content: 'Done.', reasoning_content: 'Verified.' }],
      },
    ];

    const messages = projectSessionChatMessages('conversation-1', events, []);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'user-1', role: 'user', content: 'write a file' });
    expect(messages[1]?.segments).toEqual([
      { type: 'thinking', content: 'I will inspect and write the file.' },
      expect.objectContaining({
        type: 'tool_call',
        callId: 'call-1',
        toolName: 'write_file',
        arguments: { path: 'a.txt' },
        status: 'done',
        result: 'file written',
      }),
      { type: 'thinking', content: 'The write completed; now I will verify it.' },
      { type: 'thinking', content: 'Verified.' },
      { type: 'text', content: 'Done.' },
    ]);
    expect(messages[1]).toMatchObject({
      id: 'assistant-final',
      role: 'assistant',
      content: 'Done.',
      reasoning:
        'I will inspect and write the file.\n\nThe write completed; now I will verify it.\n\nVerified.',
    });
  });

  it('merges intermediate assistant text into the final bubble', () => {
    const events: SessionEvent[] = [
      {
        ...base(1),
        type: 'model_message',
        round: 1,
        messages: [{ role: 'assistant', content: 'Earlier progress.' }],
      },
      {
        ...base(2),
        type: 'model_message',
        round: 2,
        messageId: 'assistant-final',
        messages: [{ role: 'assistant', content: 'Final answer.' }],
      },
    ];

    const [message] = projectSessionChatMessages('conversation-1', events, []);

    expect(message).toMatchObject({
      id: 'assistant-final',
      content: 'Earlier progress.\n\nFinal answer.',
    });
  });

  it('marks a recovered tool call outcome as unknown instead of failed', () => {
    const events: SessionEvent[] = [
      {
        ...base(1),
        type: 'model_message',
        round: 1,
        messages: [
          {
            role: 'assistant',
            tool_calls: [{ id: 'call-unknown', function: { name: 'write_file', arguments: '{}' } }],
          },
        ],
      },
      {
        ...base(2),
        type: 'recovery_result',
        round: 1,
        callId: 'call-unknown',
        toolName: 'write_file',
        status: 'outcome_unknown',
        ledgerStatus: 'executing',
        synthetic: true,
        message: { role: 'tool', content: 'Check the file before continuing.' },
      },
    ];

    const [message] = projectSessionChatMessages('conversation-1', events, []);
    expect(message?.segments?.[0]).toMatchObject({
      type: 'tool_call',
      status: 'outcome_unknown',
      error: 'Check the file before continuing.',
    });
  });
});

function base(seq: number): SessionEventBase {
  return {
    schemaVersion: 1,
    conversationId: 'conversation-1',
    eventId: `event-${seq}`,
    seq,
    runId: 'run-1',
    turnId: 'turn-1',
    createdAt: `2026-10-21T00:00:0${seq}.000Z`,
  };
}
