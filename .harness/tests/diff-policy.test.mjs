import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiff } from '../diff-policy.mjs';

test('ignores pre-existing changes and allows scoped changes', () => {
  const result = evaluateDiff(
    new Set(['apps/server/old.ts', 'docs/old.md']),
    new Set(['apps/server/old.ts', 'docs/old.md', 'apps/client/new.ts']),
    ['apps/client/'],
    ['.harness/'],
  );
  assert.deepEqual(result.changedPaths, ['apps/client/new.ts']);
  assert.equal(result.allowed, true);
});

test('rejects protected and out-of-scope changes', () => {
  const result = evaluateDiff(
    new Set(),
    new Set(['.harness/loop.mjs', 'apps/server/index.ts']),
    ['apps/client/'],
    ['.harness/'],
  );
  assert.equal(result.allowed, false);
  assert.deepEqual(result.violations, [
    'protected path: .harness/loop.mjs',
    'out of scope: .harness/loop.mjs',
    'out of scope: apps/server/index.ts',
  ]);
});
