import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger, Logger } from '../logger.js';

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should create logger with factory function', () => {
    const log = createLogger('test');
    expect(log).toBeInstanceOf(Logger);
  });

  it('should output JSON to stdout on debug', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = createLogger('test');
    log.debug('debug message', { key: 'value' });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('debug');
    expect(parsed.module).toBe('test');
    expect(parsed.message).toBe('debug message');
    expect(parsed.data).toEqual({ key: 'value' });
    expect(parsed.timestamp).toBeDefined();
  });

  it('should output JSON to stdout on info', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = createLogger('test');
    log.info('info message');

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('info message');
  });

  it('should output JSON to stdout on warn', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = createLogger('test');
    log.warn('warn message');

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('warn');
  });

  it('should output JSON to stdout on error', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = createLogger('test');
    log.error('error message', { error: 'something failed' });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('error');
    expect(parsed.data).toEqual({ error: 'something failed' });
  });

  it('should handle missing data parameter', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = createLogger('test');
    log.info('no data');

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.data).toBeUndefined();
  });

  it('should output ISO 8601 timestamp with millisecond precision', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = createLogger('test');
    log.info('timing');

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should separate log lines with newlines', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = createLogger('test');
    log.info('first');
    log.info('second');

    expect(writeSpy).toHaveBeenCalledTimes(2);
    const first = writeSpy.mock.calls[0][0] as string;
    const second = writeSpy.mock.calls[1][0] as string;
    expect(first).toContain('first');
    expect(second).toContain('second');
  });

  it('should create separate logger instances with different module names', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logA = createLogger('module-a');
    const logB = createLogger('module-b');
    logA.info('from a');
    logB.info('from b');

    const parsedA = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const parsedB = JSON.parse(writeSpy.mock.calls[1][0] as string);
    expect(parsedA.module).toBe('module-a');
    expect(parsedB.module).toBe('module-b');
  });
});
