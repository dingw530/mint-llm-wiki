import { describe, expect, it } from 'vitest';
import { resolveRuns } from '../runOptions.js';

describe('resolveRuns', () => {
  it('defaults live evaluation to three runs', () => {
    expect(resolveRuns(undefined, true)).toBe(3);
  });

  it('allows one or three live runs', () => {
    expect(resolveRuns('1', true)).toBe(1);
    expect(resolveRuns('3', true)).toBe(3);
  });

  it('rejects unsupported live run counts', () => {
    expect(() => resolveRuns('2', true)).toThrow('Live evaluation supports --runs 1 or --runs 3');
  });

  it('keeps non-live runs flexible', () => {
    expect(resolveRuns('5', false)).toBe(5);
  });
});
