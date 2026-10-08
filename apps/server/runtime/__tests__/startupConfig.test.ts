import { describe, expect, it } from 'vitest';
import { loadStartupConfig } from '../startupConfig.js';

describe('startup config', () => {
  it('makes runtime and listen modes explicit', () => {
    expect(loadStartupConfig({ mode: 'docker', listenMode: 'container' }, {}).host).toBe('0.0.0.0');
    expect(loadStartupConfig({ mode: 'cli', listenMode: 'loopback' }, {}).host).toBe('127.0.0.1');
  });

  it('rejects invalid ports', () => {
    expect(() => loadStartupConfig({}, { PORT: 'not-a-port' })).toThrow('Invalid PORT');
  });
});
