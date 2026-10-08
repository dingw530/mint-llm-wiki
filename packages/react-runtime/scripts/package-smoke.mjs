import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { createReactAgent } from '@mint/react-runtime';

const modelCalls = [];
const toolCalls = [];
const agent = createReactAgent({
  policy: { maxSteps: 3 },
  model: {
    async generate({ messages, step }) {
      modelCalls.push({ messages: [...messages], step });
      if (step === 1) {
        return {
          assistantMessage: { role: 'assistant', content: null },
          toolCalls: [{ id: 'weather-1', name: 'weather', input: { city: 'Paris' } }],
        };
      }
      return {
        assistantMessage: { role: 'assistant', content: 'Sunny in Paris.' },
        toolCalls: [],
      };
    },
  },
  toolExecutor: {
    async execute({ call }) {
      toolCalls.push(call.id);
      return {
        status: 'success',
        messages: [
          { role: 'assistant', toolCallId: call.id },
          { role: 'tool', toolCallId: call.id, content: 'sunny' },
        ],
      };
    },
  },
});

const result = await agent.run({
  messages: [{ role: 'user', content: 'Weather in Paris?' }],
  tools: [{ name: 'weather' }],
});

assert.equal(result.status, 'completed');
assert.equal(result.steps, 2);
assert.deepEqual(toolCalls, ['weather-1']);
assert.equal(modelCalls[1].messages.at(-1).toolCallId, 'weather-1');
assert.equal(result.messages.at(-1).content, 'Sunny in Paris.');

const declarations = await readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8');
assert.match(declarations, /createReactAgent/);
const packageMetadata = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
assert.deepEqual(packageMetadata.dependencies || {}, {});
const builtFiles = await readdir(new URL('../dist/', import.meta.url));
for (const filename of builtFiles.filter((name) => name.endsWith('.js'))) {
  const source = await readFile(new URL(`../dist/${filename}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /server\/|mint-server|from ['"](?:ai|@ai-sdk)\//);
}
await verifyInstalledTarballImport();
process.stdout.write('react-runtime package smoke passed\n');

async function verifyInstalledTarballImport() {
  const temporaryProject = await mkdtemp(path.join(tmpdir(), 'mint-react-runtime-smoke-'));
  try {
    await writeFile(path.join(temporaryProject, 'package.json'), '{"private":true}\n');
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const repositoryRoot = path.resolve(scriptDirectory, '../../..');
    const pack = spawnSync(
      'npm',
      ['pack', '--workspace', '@mint/react-runtime', '--pack-destination', temporaryProject],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    assert.equal(pack.status, 0, pack.stderr);
    const tarball = (await readdir(temporaryProject)).find((name) => name.endsWith('.tgz'));
    assert.ok(tarball, 'npm pack must create a package tarball');

    const install = spawnSync(
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
    assert.equal(install.status, 0, install.stderr);
    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { createReactAgent } from '@mint/react-runtime'; if (!createReactAgent) process.exit(1);",
      ],
      { cwd: temporaryProject, encoding: 'utf8' },
    );
    assert.equal(imported.status, 0, imported.stderr);
  } finally {
    await rm(temporaryProject, { recursive: true, force: true });
  }
}
