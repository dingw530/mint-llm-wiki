import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { ToolRuntime, ToolRuntimeRegistry } from '@mint/tool-runtime';

const registry = new ToolRuntimeRegistry();
let executionCount = 0;
const tool = { name: 'echo', enabled: true };
registry.register(tool);
const runtime = new ToolRuntime({
  registry,
  hooks: {
    isEnabled: (candidate) => candidate.enabled,
    validateInput: (_candidate, input) =>
      typeof input === 'string' ? { valid: true } : { valid: false, error: 'string required' },
    authorize: (_candidate, _input, context) =>
      context.approved
        ? { action: 'allow' }
        : { action: 'deny', code: 'DENIED', message: 'not approved' },
    execute: async (_candidate, input) => {
      executionCount += 1;
      return input;
    },
  },
});
const context = { approved: false };
assert.equal((await runtime.run('echo', 'blocked', context)).status, 'failed');
assert.equal(executionCount, 0);
const approved = await runtime.run('echo', 'allowed', { approved: true });
assert.equal(approved.status, 'succeeded');
assert.equal(executionCount, 1);

const packageMetadata = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
assert.deepEqual(packageMetadata.dependencies || {}, {});
for (const filename of (await readdir(new URL('../dist/', import.meta.url))).filter((name) =>
  name.endsWith('.js'),
)) {
  const source = await readFile(new URL(`../dist/${filename}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /server\/|mint-server|@mint\/react-runtime/);
}

const temporaryProject = await mkdtemp(path.join(tmpdir(), 'mint-tool-runtime-smoke-'));
try {
  await writeFile(path.join(temporaryProject, 'package.json'), '{"private":true}\n');
  const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(packageDirectory, '../../..');
  const packed = spawnSync(
    'npm',
    ['pack', '--workspace', '@mint/tool-runtime', '--pack-destination', temporaryProject],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const tarball = (await readdir(temporaryProject)).find((filename) => filename.endsWith('.tgz'));
  assert.ok(tarball, 'npm pack must produce a tarball');
  const installed = spawnSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(temporaryProject, tarball),
    ],
    { cwd: temporaryProject, encoding: 'utf8' },
  );
  assert.equal(installed.status, 0, installed.stderr);
  const imported = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import('@mint/tool-runtime').then(m => { if (!m.ToolRuntime) process.exit(1); })",
    ],
    { cwd: temporaryProject, encoding: 'utf8' },
  );
  assert.equal(imported.status, 0, imported.stderr);
} finally {
  await rm(temporaryProject, { recursive: true, force: true });
}
process.stdout.write('tool-runtime package smoke passed\n');
