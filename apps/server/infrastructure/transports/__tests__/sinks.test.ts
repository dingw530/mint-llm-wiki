import { describe, it, expect, vi } from 'vitest';
import { AccumulatingSink, DeferredEndSink, IpcSink, TerminalSink } from '../sinks.js';

describe('AccumulatingSink', () => {
  it('should accumulate written data', () => {
    const sink = new AccumulatingSink();
    sink.write('hello ');
    sink.write('world');
    expect(sink.data).toBe('hello world');
  });

  it('should report writableEnded as false initially', () => {
    const sink = new AccumulatingSink();
    expect(sink.writableEnded).toBe(false);
  });

  it('should report writableEnded as true after end()', () => {
    const sink = new AccumulatingSink();
    sink.end();
    expect(sink.writableEnded).toBe(true);
  });

  it('should report headersSent as false', () => {
    const sink = new AccumulatingSink();
    expect(sink.headersSent).toBe(false);
  });

  it('should return empty data initially', () => {
    const sink = new AccumulatingSink();
    expect(sink.data).toBe('');
  });

  it('serializes typed React events', () => {
    const sink = new AccumulatingSink();
    sink.writeEvent?.({ type: 'run_started', state: 'running', runId: 'run-1', sequence: 1 });
    expect(JSON.parse(sink.data)).toEqual({
      type: 'run_started',
      state: 'running',
      runId: 'run-1',
      sequence: 1,
    });
  });
});

describe('IpcSink', () => {
  function createMockEvent() {
    return {
      sender: {
        send: vi.fn(),
      },
    };
  }

  it('should send data via chat:chunk channel', () => {
    const event = createMockEvent();
    const sink = new IpcSink(event);
    sink.write('test data');
    expect(event.sender.send).toHaveBeenCalledWith('chat:chunk', 'test data');
  });

  it('should send done via chat:done channel', () => {
    const event = createMockEvent();
    const sink = new IpcSink(event);
    sink.end();
    expect(event.sender.send).toHaveBeenCalledWith('chat:done');
  });

  it('should not send after end()', () => {
    const event = createMockEvent();
    const sink = new IpcSink(event);
    sink.end();
    sink.write('late data');
    expect(event.sender.send).toHaveBeenCalledTimes(1); // only the end
  });

  it('should report writableEnded correctly', () => {
    const event = createMockEvent();
    const sink = new IpcSink(event);
    expect(sink.writableEnded).toBe(false);
    sink.end();
    expect(sink.writableEnded).toBe(true);
  });
});

describe('DeferredEndSink', () => {
  it('should defer the underlying end until flush', () => {
    const delegate = new AccumulatingSink();
    const sink = new DeferredEndSink(delegate);

    sink.write('assistant response');
    sink.end();

    expect(delegate.writableEnded).toBe(false);
    sink.flush();
    expect(delegate.writableEnded).toBe(true);
    expect(delegate.data).toBe('assistant response');
  });
});

describe('TerminalSink', () => {
  it('should not throw on write', () => {
    const sink = new TerminalSink();
    expect(() => sink.write('hello')).not.toThrow();
  });

  it('should handle JSON content events', () => {
    const sink = new TerminalSink();
    expect(() => sink.write(JSON.stringify({ content: 'test' }))).not.toThrow();
  });

  it('should handle thought events', () => {
    const sink = new TerminalSink();
    expect(() =>
      sink.write(JSON.stringify({ type: 'thought', reasoning: 'thinking...' })),
    ).not.toThrow();
  });

  it('should handle tool_call_start events', () => {
    const sink = new TerminalSink();
    expect(() =>
      sink.write(
        JSON.stringify({
          type: 'tool_call_start',
          toolName: 'bash',
          arguments: { command: 'ls' },
        }),
      ),
    ).not.toThrow();
  });

  it('should handle tool_call_end events', () => {
    const sink = new TerminalSink();
    expect(() =>
      sink.write(
        JSON.stringify({
          type: 'tool_call_end',
          result: 'file1.txt',
        }),
      ),
    ).not.toThrow();
  });

  it('should handle tool_call_error events', () => {
    const sink = new TerminalSink();
    expect(() =>
      sink.write(
        JSON.stringify({
          type: 'tool_call_error',
          error: 'failed',
          retryCount: 1,
        }),
      ),
    ).not.toThrow();
  });

  it('should handle answer_ready events', () => {
    const sink = new TerminalSink();
    expect(() => sink.write(JSON.stringify({ type: 'answer_ready' }))).not.toThrow();
  });

  it('should handle non-JSON data gracefully', () => {
    const sink = new TerminalSink();
    expect(() => sink.write('plain text')).not.toThrow();
  });

  it('should not write after end()', () => {
    const sink = new TerminalSink();
    sink.end();
    expect(() => sink.write('late')).not.toThrow();
  });

  it('should report writableEnded correctly', () => {
    const sink = new TerminalSink();
    expect(sink.writableEnded).toBe(false);
    sink.end();
    expect(sink.writableEnded).toBe(true);
  });
});
