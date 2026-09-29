import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { lockLightTheme } = require('../electron/theme.js');

test('locks Electron native appearance to light regardless of system appearance', () => {
  const nativeTheme = { themeSource: 'system' };

  lockLightTheme(nativeTheme);

  assert.equal(nativeTheme.themeSource, 'light');
});

test('declares light color scheme for browser-rendered native controls', () => {
  const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');

  assert.match(html, /<meta name="color-scheme" content="light"\s*\/>/);
});
