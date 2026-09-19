import { describe, expect, it, vi } from 'vitest';
import { AgentRun, AgentRunRegistry } from '../agentRun.js';
import type { ReactEvent } from '../reactEvents.js';

describe('AgentRun', () => {
  it('commits recovery events before notifying subscribers', () => {
    const writes: unknown[] = [];
    const run = new AgentRun({
      runId: 'durable-run',
      conversationId: 'durable-conversation',
      eventRepository: {
        append: (input) => {
          writes.push(input);
          return {
            runId: input.event.runId,
            sequence: input.sequence,
            schemaVersion: 1,
            event: input.event,
            createdAt: 'now',
          };
        },
      },
    });
    const received: ReactEvent[] = [];
    run.subscribe((event) => received.push(event));

    run.publish({ type: 'run_started', state: 'running' });
    run.publish({ type: 'thought', content: 'not durable' });
    run.publish({ type: 'run_completed', state: 'completed', content: 'done', reasoning: '' });

    expect(writes).toHaveLength(2);
    expect((writes[0] as { sequence: number }).sequence).toBe(1);
    expect((writes[1] as { sequence: number }).sequence).toBe(2);
    expect(received).toHaveLength(3);
  });

  it('does not notify subscribers when a durable commit fails', () => {
    const received: ReactEvent[] = [];
    const run = new AgentRun({
      runId: 'failed-durable-run',
      eventRepository: {
        append: () => {
          throw new Error('disk full');
        },
      },
    });
    run.subscribe((event) => received.push(event));

    expect(() => run.publish({ type: 'run_started', state: 'running' })).toThrow('disk full');
    expect(received).toHaveLength(0);
    expect(run.getSnapshot()).toMatchObject({ sequence: 0, terminal: false, phase: 'running' });
  });

  it('assigns strictly increasing sequences and publishes only one terminal event', () => {
    const run = new AgentRun({ runId: 'run-1', conversationId: 'conversation-1' });
    const events: ReactEvent[] = [];
    run.subscribe((event) => events.push(event));

    run.publish({ type: 'run_started', state: 'running' });
    run.publish({ type: 'round_started', state: 'awaiting_model', round: 1 });
    run.publish({ type: 'run_completed', state: 'completed', content: 'done', reasoning: '' });

    expect(
      run.publish({ type: 'run_failed', state: 'failed', error: 'late error' }),
    ).toBeUndefined();
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(
      events.filter((event) =>
        ['run_completed', 'run_failed', 'run_cancelled'].includes(event.type),
      ),
    ).toHaveLength(1);
    expect(run.getSnapshot()).toMatchObject({ phase: 'completed', terminal: true, sequence: 3 });
  });

  it('returns defensive snapshots without exposing mutable tool or approval state', () => {
    const run = new AgentRun({ runId: 'run-2' });
    run.publish({
      type: 'tool_call_start',
      state: 'executing_tools',
      round: 1,
      callId: 'call-1',
      toolName: 'bash',
      arguments: {},
    });
    run.publish({
      type: 'approval_required',
      round: 1,
      callId: 'call-1',
      toolName: 'bash',
      approvalId: 'approval-1',
      reason: 'confirm',
    });

    const snapshot = run.getSnapshot();
    snapshot.toolCalls[0].status = 'failed';
    if (snapshot.approval) snapshot.approval.reason = 'mutated';

    expect(run.getSnapshot()).toMatchObject({
      phase: 'paused_for_approval',
      toolCalls: [{ status: 'approval_required' }],
      approval: { reason: 'confirm' },
    });
  });

  it('isolates subscriber failures from other subscribers and the event publisher', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = new AgentRun({ runId: 'run-3' });
    const received = vi.fn();
    run.subscribe(() => {
      throw new Error('subscriber failure');
    });
    run.subscribe(received);

    expect(() => run.publish({ type: 'run_started', state: 'running' })).not.toThrow();
    expect(received).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('pauses and resumes only for the approval that caused the pause', () => {
    const run = new AgentRun({ runId: 'run-4' });
    run.publish({
      type: 'approval_required',
      round: 2,
      callId: 'call-4',
      toolName: 'write_file',
      approvalId: 'approval-4',
      reason: 'writes a file',
    });

    expect(run.resumeApproval('other-approval')).toBe(false);
    expect(run.getSnapshot().phase).toBe('paused_for_approval');
    expect(run.resumeApproval('approval-4')).toBe(true);
    expect(run.getSnapshot().phase).toBe('running');
    expect(run.getSnapshot()).not.toHaveProperty('approval');
  });
});

describe('AgentRunRegistry', () => {
  it('indexes active runs by conversation and removes them after a terminal event', () => {
    const registry = new AgentRunRegistry();
    const run = new AgentRun({ runId: 'run-5', conversationId: 'conversation-5' });
    registry.register(run);

    expect(registry.get('run-5')).toBe(run);
    expect(registry.getByConversation('conversation-5')).toBe(run);

    run.cancel();

    expect(registry.get('run-5')).toBeUndefined();
    expect(registry.getByConversation('conversation-5')).toBeUndefined();
  });

  it('cancels every active run during process shutdown', () => {
    const registry = new AgentRunRegistry();
    const first = new AgentRun({ runId: 'run-6' });
    const second = new AgentRun({ runId: 'run-7' });
    registry.register(first);
    registry.register(second);

    registry.cancelAll();

    expect(first.getSnapshot()).toMatchObject({ phase: 'cancelled', terminal: true });
    expect(second.getSnapshot()).toMatchObject({ phase: 'cancelled', terminal: true });
    expect(registry.get('run-6')).toBeUndefined();
    expect(registry.get('run-7')).toBeUndefined();
  });
});
