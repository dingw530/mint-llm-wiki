import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWindowQueryScript, captureMacosWindow } from './macos-window-capture.mjs';

test('builds a Window Server query scoped to the requested owner', () => {
  const query = buildWindowQueryScript('Mint');
  assert.match(query, /CGWindowListCopyWindowInfo/);
  assert.match(query, /localizedCaseInsensitiveContains\(\$0\)/);
  assert.match(query, /Mint/);
});

test('refuses native capture outside macOS', () => {
  if (process.platform === 'darwin') return;
  assert.throws(() => captureMacosWindow(), /process\.platform === "darwin"/);
});
