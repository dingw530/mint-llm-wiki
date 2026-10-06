import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../application/settings/settings-service.js', () => ({
  getAiSettings: vi.fn(() => ({ wikiPath: '' })),
}));

import { isPathSafe } from '../path-security.js';

describe('pathSecurity', () => {
  describe('isPathSafe', () => {
    it('allows valid paths within root', () => {
      expect(isPathSafe('/tmp/wiki', 'pages/test.md')).toBe(true);
      expect(isPathSafe('/tmp/wiki', 'sources/test.txt')).toBe(true);
    });

    it('blocks path traversal', () => {
      expect(isPathSafe('/tmp/wiki', '../../../../etc/passwd')).toBe(false);
      expect(isPathSafe('/tmp/wiki', '../../../other/file.md')).toBe(false);
    });

    it('blocks absolute paths', () => {
      expect(isPathSafe('/tmp/wiki', '/etc/passwd')).toBe(false);
    });

    it('returns false for empty target', () => {
      expect(isPathSafe('/tmp/wiki', '')).toBe(false);
    });

    it('returns false for empty root', () => {
      expect(isPathSafe('', 'pages/test.md')).toBe(false);
    });
  });
});
