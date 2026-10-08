import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWindowOptions } = require('../apps/electron/window-options.js');

test('darwin enables sidebar vibrancy and transparent background', () => {
  const options = createWindowOptions('darwin', '/tmp/electron');

  assert.equal(options.backgroundColor, '#00000000');
  assert.equal(options.vibrancy, 'sidebar');
  assert.equal(options.visualEffectState, 'active');
  assert.equal(options.frame, false);
});

test('non-darwin keeps opaque background and omits native material', () => {
  const options = createWindowOptions('linux', '/tmp/electron');

  assert.equal(options.backgroundColor, '#f1f5f3');
  assert.equal('vibrancy' in options, false);
  assert.equal('visualEffectState' in options, false);
  assert.equal(options.frame, false);
});
