import { describe, expect, it } from 'vitest';
import {
  createInitialReactEventState,
  reduceReactEvent,
  type ReactReducerEvent,
  type ReactEventState,
} from '../useReactEventReducer';

describe('reduceReactEvent', () => {
  function reduce(state: ReactEventState, ...events: ReactReducerEvent[]) {
    return events.reduce((current, event) => reduceReactEvent(current, event), state);
  }

  it('starts a run and accumulates adjacent thought events', () => {
    const state = reduce(
      createInitialReactEventState(),
      { type: 'run_started', runId: 'run-1' },
      { type: 'thought', content: '先检查 ' },
      { type: 'thought', content: '上下文' },
    );
    expect(state).toMatchObject({ status: 'running', runId: 'run-1' });
    expect(state.steps).toEqual([{ type: 'thought', content: '先检查 上下文' }]);
  });

  it('keeps tool summaries and ignores events from another run', () => {
    const started = reduceReactEvent(createInitialReactEventState(), {
      type: 'run_started',
      runId: 'run-1',
    });
    const withTool = reduceReactEvent(started, {
      type: 'tool_call_start',
      runId: 'run-1',
      callId: 'call-1',
      toolName: 'wiki_search',
      arguments: '{}',
      summary: '搜索知识库',
    });
    expect(
      reduceReactEvent(withTool, { type: 'thought', runId: 'run-2', content: '错误事件' }),
    ).toBe(withTool);
    expect(withTool.steps).toEqual([
      expect.objectContaining({ callId: 'call-1', summary: '搜索知识库' }),
    ]);
  });

  it('stops accepting events after a terminal status', () => {
    const completed = reduceReactEvent(
      reduceReactEvent(createInitialReactEventState(), { type: 'run_started', runId: 'run-1' }),
      { type: 'run_completed', runId: 'run-1' },
    );
    expect(reduceReactEvent(completed, { type: 'thought', content: 'late event' })).toBe(completed);
  });

  it('ignores out-of-order AgentRun events while accepting strictly increasing sequences', () => {
    const started = reduceReactEvent(createInitialReactEventState(), {
      type: 'run_started',
      runId: 'run-1',
      sequence: 1,
    });
    const thought = reduceReactEvent(started, {
      type: 'thought',
      runId: 'run-1',
      sequence: 3,
      content: 'current event',
    });

    expect(
      reduceReactEvent(thought, {
        type: 'thought',
        runId: 'run-1',
        sequence: 2,
        content: 'stale event',
      }),
    ).toBe(thought);
    expect(thought).toMatchObject({ lastSequence: 3, steps: [{ content: 'current event' }] });
  });

  it('builds a safe action trace without thought, arguments, or raw results', () => {
    const state = reduce(
      createInitialReactEventState(),
      { type: 'run_started', runId: 'run-1' },
      { type: 'round_started', runId: 'run-1', round: 1 },
      {
        type: 'tool_call_start',
        runId: 'run-1',
        toolName: 'wiki_search',
        arguments: { secret: 'do-not-show' },
        summary: '搜索知识库',
      },
      {
        type: 'tool_call_end',
        runId: 'run-1',
        toolName: 'wiki_search',
        result: 'raw result should not show',
        duration: 1200,
      },
      { type: 'thought', runId: 'run-1', content: 'internal thought should not show' },
      { type: 'run_completed', runId: 'run-1' },
    );

    expect(state.decisionTrace.map((item) => item.label)).toEqual([
      '开始分析问题',
      '分析第 1 轮',
      '执行动作：搜索知识库',
      '动作完成：wiki_search',
      '已完成回答',
    ]);
    expect(JSON.stringify(state.decisionTrace)).not.toContain('do-not-show');
    expect(JSON.stringify(state.decisionTrace)).not.toContain('raw result should not show');
    expect(JSON.stringify(state.decisionTrace)).not.toContain('internal thought should not show');
    expect(state.decisionTrace.every((item) => item.status !== 'active')).toBe(true);
  });

  it('represents retries, failures, and loop fallback as action states', () => {
    const state = reduce(
      createInitialReactEventState(),
      { type: 'run_started', runId: 'run-1' },
      {
        type: 'tool_call_error',
        runId: 'run-1',
        toolName: 'bash',
        phase: 'retrying',
        retryCount: 1,
      },
      { type: 'loop_detected', runId: 'run-1', message: '重复调用' },
      { type: 'run_failed', runId: 'run-1', error: 'network error' },
    );

    expect(state.decisionTrace.map((item) => item.kind)).toEqual([
      'start',
      'retry',
      'fallback',
      'failed',
    ]);
    expect(state.decisionTrace[1].detail).toBe('第 1 次重试');
  });
});
