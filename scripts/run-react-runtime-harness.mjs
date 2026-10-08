import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changeId = '2026-10-08-react-runtime-package';
const configPath = path.join(repositoryRoot, 'docs', 'changes', changeId, 'harness-checks.json');
const checks = JSON.parse(await readFile(configPath, 'utf8')).checks;
const result = spawnSync(
  process.execPath,
  [
    '.harness/cli.mjs',
    'verify',
    '--change',
    changeId,
    '--checks',
    JSON.stringify(checks),
    ...process.argv.slice(2),
  ],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
