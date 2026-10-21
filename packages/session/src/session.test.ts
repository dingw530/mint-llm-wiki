import { describe, expect, it } from 'vitest';
import type { SessionEvent } from './contracts.js';
import { deriveModelHistory } from './model-projection.js';
import { planSessionRecovery } from './recovery.js';
import { projectTrace } from './trace/projector.js';
import { validateSessionEventBatch, validateSessionEvents } from './validation.js';

function eventBase(eventId: string, seq: number) {
  return {
    schemaVersion: 1 as const,
    conversationId: 'conversation-1',
    eventId,
    seq,
    runId: 'run-1',
    turnId: 'turn-1',
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}

function assistantToolCall(eventId = 'model-1', seq = 2): SessionEvent {
  return {
    ...eventBase(eventId, seq),
    type: 'model_message',
    round: 1,
    messages: [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'write_file', arguments: '{"path":"a.txt"}' },
          },
        ],
      },
    ],
  };
}

function interruptedPrefix(): SessionEvent[] {
  return [
    { ...eventBase('turn-1-start', 1), type: 'turn_started' },
    assistantToolCall(),
    {
      ...eventBase('dispatch-1', 3),
      type: 'tool_dispatch_committed',
      round: 1,
      callId: 'call-1',
      toolName: 'write_file',
      argumentsJson: '{"path":"a.txt"}',
      retrySafety: 'never',
    },
  ];
}

describe('session event validation', () => {
  it('validates an append batch whose tool intent references a prior committed event', () => {
    const events = interruptedPrefix();
    expect(validateSessionEventBatch(events.slice(0, 2))).toHaveLength(2);
    expect(validateSessionEventBatch([events[2]!], 3)).toHaveLength(1);
    expect(() => validateSessionEvents(events)).not.toThrow();
  });

  it('rejects sequence gaps and duplicate event identities', () => {
    const events = interruptedPrefix();
    expect(() => validateSessionEvents([...events, { ...events[2]!, seq: 5 }])).toThrow(
      'Session event sequence gap',
    );
    expect(() => validateSessionEvents([...events, { ...events[2]!, seq: 4 }])).toThrow(
      'Duplicate session event id',
    );
  });

  it('validates an optional assistant chat message identity', () => {
    const event = assistantToolCall('model-id', 1);
    expect(() => validateSessionEventBatch([{ ...event, messageId: '' }])).toThrow(
      'Session messageId is required',
    );
  });

  it('rejects duplicate dispatches and results for the same call identity', () => {
    const events = interruptedPrefix();
    expect(() =>
      validateSessionEvents([...events, { ...events[2]!, seq: 4, eventId: 'dispatch-2' }]),
    ).toThrow('Duplicate tool dispatch');
    const result: SessionEvent = {
      ...eventBase('result-1', 4),
      type: 'tool_result',
      round: 1,
      callId: 'call-1',
      toolName: 'write_file',
      dispatchCommitted: true,
      status: 'success',
      message: { role: 'tool', tool_call_id: 'call-1', content: 'written' },
    };
    expect(() =>
      validateSessionEvents([...events, result, { ...result, seq: 5, eventId: 'result-2' }]),
    ).toThrow('Duplicate tool result');
  });

  it('requires dispatch identity and original arguments to match the model tool call', () => {
    const events = interruptedPrefix();
    expect(() =>
      validateSessionEvents([
        events[0]!,
        events[1]!,
        { ...events[2]!, argumentsJson: '{"path":"other.txt"}' },
      ]),
    ).toThrow('Tool arguments do not match model call');
    const result: SessionEvent = {
      ...eventBase('result-1', 3),
      type: 'tool_result',
      round: 1,
      callId: 'call-1',
      toolName: 'write_file',
      dispatchCommitted: true,
      status: 'success',
      message: { role: 'tool', tool_call_id: 'call-1', content: 'written' },
    };
    expect(() => validateSessionEvents([events[0]!, events[1]!, result])).toThrow(
      'Tool result has no committed dispatch',
    );
  });

  it('rejects non-JSON messages and unsupported event schema versions', () => {
    const events = interruptedPrefix();
    const invalidJson = {
      ...events[1]!,
      messages: [{ role: 'assistant', content: Number.NaN }],
    } as SessionEvent;
    expect(() => validateSessionEvents([events[0]!, invalidJson, events[2]!])).toThrow(
      'Non-finite number',
    );
    expect(() =>
      validateSessionEvents([{ ...events[0]!, schemaVersion: 2 } as SessionEvent]),
    ).toThrow('Unsupported session event schema version');
  });

  it('copies JSON tool schemas and rejects executable values', () => {
    const schema = { type: 'object', properties: { path: { type: 'string' } } };
    const message = {
      ...eventBase('tool-catalog-1', 1),
      type: 'tool_catalog' as const,
      round: 1,
      tools: [{ name: 'read_file', parameters: schema }],
    };
    const copy = validateSessionEvents([message]);
    schema.properties.path.type = 'changed';
    expect(copy[0]?.type === 'tool_catalog' && copy[0].tools[0]).toEqual({
      name: 'read_file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    });
  });
});

describe('session projections', () => {
  it('projects model messages, context replacement, and tool results in event order', () => {
    const events: SessionEvent[] = [
      {
        ...eventBase('user-1', 1),
        type: 'user_message',
        messageId: 'message-1',
        content: 'write a file',
      },
      {
        ...eventBase('context-1', 2),
        type: 'context_snapshot',
        round: 1,
        scope: 'system',
        operation: 'append',
        source: 'runtime',
        messages: [{ role: 'system', content: 'Current runtime facts' }],
      },
      assistantToolCall('model-1', 3),
      {
        ...eventBase('dispatch-1', 4),
        type: 'tool_dispatch_committed',
        round: 1,
        callId: 'call-1',
        toolName: 'write_file',
        argumentsJson: '{"path":"a.txt"}',
        retrySafety: 'never',
      },
      {
        ...eventBase('result-1', 5),
        type: 'tool_result',
        round: 1,
        callId: 'call-1',
        toolName: 'write_file',
        dispatchCommitted: true,
        status: 'success',
        message: { role: 'tool', tool_call_id: 'call-1', content: 'written' },
      },
    ];
    const history = deriveModelHistory(events);
    expect(history.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    const assistant = history[2];
    expect(assistant?.tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'write_file', arguments: '{"path":"a.txt"}' },
      },
    ]);
    expect(history[3]?.content).toBe('written');
  });

  it('replaces only the active history and returns detached message objects', () => {
    const source: SessionEvent[] = [
      { ...eventBase('user-1', 1), type: 'user_message', messageId: 'message-1', content: 'old' },
      {
        ...eventBase('context-1', 2),
        type: 'context_snapshot',
        round: 1,
        scope: 'history',
        operation: 'replace',
        source: 'summary',
        messages: [{ role: 'system', content: { parts: ['summary'] } }],
      },
    ];
    const history = deriveModelHistory(source);
    expect(history).toHaveLength(1);
    const content = history[0]?.content;
    if (content === null || typeof content !== 'object' || Array.isArray(content)) {
      throw new Error('expected structured context content');
    }
    const parts = content.parts;
    if (!Array.isArray(parts)) throw new Error('expected context parts');
    parts[0] = 'changed';
    expect(source[1]?.type === 'context_snapshot' && source[1].messages[0]?.content).toEqual({
      parts: ['summary'],
    });
  });

  it('applies an appended history snapshot once after the durable conversation prefix', () => {
    const source: SessionEvent[] = [
      {
        ...eventBase('user-prefix', 1),
        type: 'user_message',
        messageId: 'message-1',
        content: 'old',
      },
      {
        ...eventBase('history-append', 2),
        type: 'context_snapshot',
        round: 1,
        scope: 'history',
        operation: 'append',
        source: 'context-window',
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-compressed',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.md"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call-compressed', content: 'compressed details' },
        ],
      },
    ];

    expect(deriveModelHistory(source)).toEqual([
      { role: 'user', content: 'old' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-compressed',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.md"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-compressed', content: 'compressed details' },
    ]);
  });

  it('restores only the active turn system and anchored contexts around the matching user message', () => {
    const source: SessionEvent[] = [
      { ...eventBase('turn-old', 1), type: 'turn_started' },
      {
        ...eventBase('user-old', 2),
        type: 'user_message',
        messageId: 'message-old',
        content: 'old',
      },
      {
        ...eventBase('old-context', 3),
        type: 'context_snapshot',
        round: 1,
        scope: 'anchor',
        operation: 'append',
        source: 'memory',
        anchorMessageId: 'message-old',
        messages: [{ role: 'user', content: 'old memory result' }],
      },
      {
        ...eventBase('assistant-old', 4),
        type: 'model_message',
        round: 1,
        messages: [{ role: 'assistant', content: 'old answer' }],
      },
      { ...eventBase('turn-new', 5), type: 'turn_started' },
      {
        ...eventBase('user-new', 6),
        type: 'user_message',
        messageId: 'message-new',
        content: 'new',
      },
      {
        ...eventBase('system-new', 7),
        turnId: 'turn-new',
        type: 'context_snapshot',
        round: 1,
        scope: 'system',
        operation: 'replace',
        source: 'system-prompt',
        messages: [{ role: 'system', content: 'current system' }],
      },
      {
        ...eventBase('new-context', 8),
        turnId: 'turn-new',
        type: 'context_snapshot',
        round: 1,
        scope: 'anchor',
        operation: 'append',
        source: 'wiki',
        anchorMessageId: 'message-new',
        messages: [{ role: 'user', content: 'current wiki result' }],
      },
    ];

    expect(deriveModelHistory(source, { turnId: 'turn-new' })).toEqual([
      { role: 'system', content: 'current system' },
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'current wiki result' },
      { role: 'user', content: 'new' },
    ]);
  });

  it('refuses to send an open tool call to a model before recovery closes it', () => {
    const open = interruptedPrefix().slice(0, 2);
    expect(() => deriveModelHistory(open)).toThrow('dangling tool calls: call-1');
  });
});

describe('crash recovery planning', () => {
  it('marks a dispatched tool outcome unknown without replaying it', () => {
    const plan = planSessionRecovery(interruptedPrefix(), 'run-1', {
      hasActiveOwner: false,
      readLedgerStatus: () => 'succeeded',
      now: '2026-10-20T00:01:00.000Z',
    });
    expect(plan.status).toBe('ready');
    expect(plan.expectedLastSequence).toBe(3);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      seq: 4,
      eventId: 'recovery:run-1:call-1:outcome_unknown',
      status: 'outcome_unknown',
      ledgerStatus: 'succeeded',
      synthetic: true,
      message: { role: 'tool', tool_call_id: 'call-1' },
    });
    expect(plan.events[0]?.message.content).toContain('Do not invoke it again');
  });

  it('marks a recorded model call without a dispatch as not started', () => {
    const events = interruptedPrefix().filter((event) => event.type !== 'tool_dispatch_committed');
    const plan = planSessionRecovery(events, 'run-1', {
      hasActiveOwner: false,
      readLedgerStatus: () => 'missing',
      now: '2026-10-20T00:01:00.000Z',
    });
    expect(plan.events[0]).toMatchObject({
      status: 'not_started',
      ledgerStatus: 'missing',
      seq: 3,
    });
    const trace = projectTrace([...events, ...plan.events]);
    expect(trace.entries.at(-1)).toMatchObject({
      callId: 'call-1',
      status: 'not_started',
      synthetic: true,
    });
  });

  it('does not repair a live owner and produces no duplicate repair after append', () => {
    const events = interruptedPrefix();
    const options = {
      hasActiveOwner: false,
      readLedgerStatus: () => 'outcome_unknown' as const,
      now: '2026-10-20T00:01:00.000Z',
    };
    expect(planSessionRecovery(events, 'run-1', { ...options, hasActiveOwner: true }).status).toBe(
      'blocked_active_owner',
    );
    const repair = planSessionRecovery(events, 'run-1', options);
    expect(planSessionRecovery([...events, ...repair.events], 'run-1', options).status).toBe(
      'nothing_to_repair',
    );
    expect(planSessionRecovery(events, 'run-1', options).events[0]?.eventId).toBe(
      repair.events[0]?.eventId,
    );
  });
});

describe('safe trajectory projection', () => {
  it('groups a result with its dispatched tool row without copying sensitive payloads', () => {
    const events: SessionEvent[] = [
      ...interruptedPrefix(),
      {
        ...eventBase('recovery-1', 4),
        type: 'recovery_result',
        round: 1,
        callId: 'call-1',
        toolName: 'write_file',
        status: 'outcome_unknown',
        ledgerStatus: 'succeeded',
        synthetic: true,
        message: { role: 'tool', tool_call_id: 'call-1', content: 'secret-content' },
      },
    ];
    const projection = projectTrace(events);
    expect(projection.entries).toHaveLength(3);
    expect(projection.entries[2]).toMatchObject({
      callId: 'call-1',
      status: 'outcome_unknown',
      eventIds: ['dispatch-1', 'recovery-1'],
      detailEventIds: ['dispatch-1', 'recovery-1'],
      synthetic: true,
    });
    expect(projection.events).toHaveLength(events.length);
    expect(projection.events[3]).toMatchObject({
      eventId: 'recovery-1',
      type: 'recovery_result',
      callId: 'call-1',
      status: 'outcome_unknown',
      detailAvailable: true,
      synthetic: true,
    });
    expect(projection.runs).toEqual([
      {
        runId: 'run-1',
        status: 'running',
        originRunId: null,
        turnId: 'turn-1',
        startedAt: '2026-10-20T00:00:00.000Z',
        endedAt: null,
      },
    ]);
    expect(JSON.stringify(projection)).not.toContain('secret-content');
  });

  it('summarizes successor run lineage and final runtime state', () => {
    const events: SessionEvent[] = [
      {
        ...eventBase('recovery-turn', 1),
        type: 'turn_started',
        originRunId: 'origin-run',
        recoveryActionId: 'action-1',
        recoveryAction: 'continue',
      },
      {
        ...eventBase('terminal', 2),
        type: 'run_terminal',
        outcome: 'completed',
      },
    ];
    expect(projectTrace(events).runs).toEqual([
      {
        runId: 'run-1',
        status: 'completed',
        originRunId: 'origin-run',
        turnId: 'turn-1',
        startedAt: '2026-10-20T00:00:00.000Z',
        endedAt: '2026-10-20T00:00:00.000Z',
      },
    ]);
  });
});
