import { describe, expect, it, vi } from 'vitest';
import {
  buildUrlFromManifest,
  extractBodyFromManifest,
  ipcOrHttp,
  isElectron,
  parseSSEChunk,
} from '../_base';

describe('API base helpers', () => {
  it('builds manifest URLs and extracts body arguments', () => {
    const endpoint = {
      id: 'test',
      ipcChannel: 'test',
      preloadMethod: null,
      method: 'POST',
      httpPath: '/items/:id?kind=all',
      args: [
        { from: 'path', name: 'id' },
        { from: 'query', name: 'filter', optional: true },
        { from: 'body', name: 'payload' },
      ],
      result: null,
      async: false,
    } as const;
    const args = ['a/b', 'x y', { enabled: true }];
    expect(buildUrlFromManifest(endpoint, args)).toBe('/items/a/b?kind=all&filter=x%20y');
    expect(extractBodyFromManifest(endpoint, args)).toEqual({ enabled: true });
    expect(extractBodyFromManifest({ ...endpoint, args: [] }, [])).toBeUndefined();
  });

  it('uses HTTP outside Electron and preserves Electron IPC errors', async () => {
    window.electronAPI = undefined;
    expect(isElectron()).toBe(false);
    const http = vi.fn().mockResolvedValue('http');
    expect(await ipcOrHttp(vi.fn(), http)).toBe('http');
    window.electronAPI = { isElectron: true } as unknown as typeof window.electronAPI;
    await expect(
      ipcOrHttp(vi.fn().mockRejectedValue(new Error('IPC failed')), http),
    ).rejects.toThrow('IPC failed');
    expect(http).toHaveBeenCalledOnce();
  });

  it('dispatches SSE event types and tracks thought text', () => {
    const callbacks = {
      onThought: vi.fn(),
      onAnswerReady: vi.fn(),
      onToolCallStart: vi.fn(),
      onChunk: vi.fn(),
      onRouting: vi.fn(),
      onTokenUsage: vi.fn(),
      onRoundStarted: vi.fn(),
      onAgentStatus: vi.fn(),
      onLoopDetected: vi.fn(),
      onToolApprovalRequired: vi.fn(),
      onA2ui: vi.fn(),
    };
    const lastThought = { value: '' };
    parseSSEChunk({ type: 'round_started', round: 2 }, callbacks, lastThought);
    parseSSEChunk({ type: 'agent_status', round: 2, toolCount: 1 }, callbacks, lastThought);
    parseSSEChunk({ type: 'thought', content: 'thinking' }, callbacks, lastThought);
    parseSSEChunk({ type: 'tool_call_start', callId: 'call-1' }, callbacks, lastThought);
    parseSSEChunk({ type: 'answer', content: 'answer' }, callbacks, lastThought);
    parseSSEChunk(
      {
        type: 'a2ui',
        segmentId: 'segment-1',
        surfaceId: 'surface-1',
        message: { version: 'v0.9' },
      },
      callbacks,
      lastThought,
    );
    parseSSEChunk({ type: 'agent', agent: 'custom-agent' }, callbacks, lastThought);
    parseSSEChunk({ type: 'answer_ready' }, callbacks, lastThought);
    parseSSEChunk({ type: 'token_usage', estimatedTokens: 42 }, callbacks, lastThought);
    parseSSEChunk({ type: 'loop_detected', message: 'fallback' }, callbacks, lastThought);
    parseSSEChunk(
      { type: 'approval_required', approvalId: 'approval-1', reason: 'confirm' },
      callbacks,
      lastThought,
    );
    expect(callbacks.onThought).toHaveBeenCalledWith('thinking');
    expect(callbacks.onToolCallStart).toHaveBeenCalled();
    expect(callbacks.onChunk).toHaveBeenCalledWith('answer');
    expect(callbacks.onRouting).toHaveBeenCalledWith('custom-agent');
    expect(callbacks.onAnswerReady).not.toHaveBeenCalled();
    expect(callbacks.onTokenUsage).toHaveBeenCalledWith({
      type: 'token_usage',
      estimatedTokens: 42,
    });
    expect(callbacks.onRoundStarted).toHaveBeenCalledWith({ type: 'round_started', round: 2 });
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith({
      type: 'agent_status',
      round: 2,
      toolCount: 1,
    });
    expect(callbacks.onLoopDetected).toHaveBeenCalledWith({
      type: 'loop_detected',
      message: 'fallback',
    });
    expect(callbacks.onToolApprovalRequired).toHaveBeenCalledWith({
      type: 'approval_required',
      approvalId: 'approval-1',
      reason: 'confirm',
    });
    expect(callbacks.onA2ui).toHaveBeenCalledWith({
      type: 'a2ui',
      segmentId: 'segment-1',
      surfaceId: 'surface-1',
      message: { version: 'v0.9' },
    });
  });

  it('rejects incomplete AgentRun envelopes but keeps legacy chunks compatible', () => {
    const callbacks = { onChunk: vi.fn() };
    const lastThought = { value: '' };

    parseSSEChunk(
      { type: 'answer', runId: 'run-1', content: 'missing sequence' },
      callbacks,
      lastThought,
    );
    parseSSEChunk(
      { type: 'answer', sequence: 1, content: 'missing run id' },
      callbacks,
      lastThought,
    );
    parseSSEChunk(
      { type: 'answer', runId: 'run-1', sequence: 1, content: 'valid' },
      callbacks,
      lastThought,
    );
    parseSSEChunk({ type: 'answer', content: 'legacy' }, callbacks, lastThought);

    expect(callbacks.onChunk).toHaveBeenCalledTimes(2);
    expect(callbacks.onChunk).toHaveBeenNthCalledWith(1, 'valid');
    expect(callbacks.onChunk).toHaveBeenNthCalledWith(2, 'legacy');
  });
});
