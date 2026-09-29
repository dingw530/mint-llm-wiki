import { describe, expect, it, vi } from 'vitest';

vi.mock('react-dom/client', () => ({
  default: { createRoot: () => ({ render: vi.fn() }) },
}));

import { applyPlatformClass } from './main';

describe('applyPlatformClass', () => {
  it('marks only the darwin Electron renderer', () => {
    const root = document.createElement('html');

    applyPlatformClass(root, { isElectron: true, platform: 'darwin' });

    expect(root.classList.contains('platform-darwin-electron')).toBe(true);
  });

  it('keeps the marker absent for browser and non-darwin renderers', () => {
    const root = document.createElement('html');
    root.classList.add('platform-darwin-electron');

    applyPlatformClass(root, undefined);
    expect(root.classList.contains('platform-darwin-electron')).toBe(false);

    applyPlatformClass(root, { isElectron: true, platform: 'linux' });
    expect(root.classList.contains('platform-darwin-electron')).toBe(false);
  });
});
