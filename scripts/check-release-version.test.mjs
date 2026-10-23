import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkReleaseVersion } from './check-release-version.mjs';

const packagePaths = [
  'apps/agent-eval/package.json',
  'apps/client/package.json',
  'apps/electron/package.json',
  'apps/server/package.json',
  'apps/website/package.json',
  'packages/react-runtime/package.json',
  'packages/tool-runtime/package.json',
];

async function createWorkspace(version) {
  const root = await mkdtemp(join(tmpdir(), 'mint-release-version-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ version, workspaces: packagePaths.map((path) => dirname(path)) }),
  );
  for (const packagePath of packagePaths) {
    const file = join(root, packagePath);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify({ version }));
  }
  return root;
}

test('accepts a consistent workspace and matching v-prefixed tag', async () => {
  const root = await createWorkspace('0.1.0');
  try {
    const result = await checkReleaseVersion(root, 'v0.1.0');
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects workspace version drift and a mismatched release tag', async () => {
  const root = await createWorkspace('0.1.0');
  try {
    await writeFile(join(root, 'apps/electron/package.json'), JSON.stringify({ version: '0.2.0' }));
    const result = await checkReleaseVersion(root, 'v0.2.0');
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
