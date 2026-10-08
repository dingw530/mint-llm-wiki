import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'mint-tool-outcome-'));
const databasePath = path.join(temporaryDirectory, 'tool-invocation.db');
const sideEffectMarkerPath = path.join(temporaryDirectory, 'side-effect-count.txt');

const childSource = `
  import Database from 'better-sqlite3';
  import { existsSync, appendFileSync } from 'node:fs';
  import { runMigrations } from './apps/server/migrations/index.ts';
  import { ToolInvocationRepository } from './apps/server/infrastructure/persistence/tool-invocation-repository.ts';

  const db = new Database(process.env.MINT_TOOL_SMOKE_DB);
  if (!existsSync(process.env.MINT_TOOL_SMOKE_MIGRATED)) {
    db.exec("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))" );
    const applied = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
    for (let id = 1; id <= 32; id += 1) applied.run(id, 'fixture-' + id);
    runMigrations(db);
    appendFileSync(process.env.MINT_TOOL_SMOKE_MIGRATED, 'ready');
  }

  const repository = new ToolInvocationRepository(db);
  const invocation = {
    runId: 'process-run',
    callId: 'process-call',
    invocationId: 'stable-process-invocation',
    toolName: 'write_file',
    inputHash: 'input-hash',
    retrySafety: 'never',
  };

  if (process.env.MINT_TOOL_SMOKE_MODE === 'crash') {
    const claim = repository.begin(invocation);
    if (!claim.allowed) process.exit(2);
    appendFileSync(process.env.MINT_TOOL_SMOKE_SIDE_EFFECT, 'x');
    db.close();
    process.exit(86);
  }

  repository.markInterruptedUnknown();
  const record = repository.get(invocation.runId, invocation.callId);
  const retry = repository.begin(invocation);
  if (retry.allowed) appendFileSync(process.env.MINT_TOOL_SMOKE_SIDE_EFFECT, 'x');
  process.stdout.write(JSON.stringify({ status: record?.status, retryAllowed: retry.allowed, errorCode: retry.allowed ? undefined : retry.errorCode }));
  db.close();
`;

function runChild(mode) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', childSource],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        MINT_TOOL_SMOKE_MODE: mode,
        MINT_TOOL_SMOKE_DB: databasePath,
        MINT_TOOL_SMOKE_MIGRATED: path.join(temporaryDirectory, 'migration-ready'),
        MINT_TOOL_SMOKE_SIDE_EFFECT: sideEffectMarkerPath,
      },
      timeout: 30_000,
    },
  );
}

try {
  const interrupted = runChild('crash');
  assert.equal(
    interrupted.status,
    86,
    `first child did not stop at the injected crash point: ${interrupted.stderr}`,
  );
  assert.equal(readFileSync(sideEffectMarkerPath, 'utf8'), 'x');

  const recovered = runChild('recover');
  assert.equal(recovered.status, 0, `recovery child failed: ${recovered.stderr}`);
  const resultLine = recovered.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('{'));
  assert.ok(resultLine, `recovery child returned no JSON result: ${recovered.stdout}`);
  const result = JSON.parse(resultLine);
  assert.deepEqual(result, {
    status: 'outcome_unknown',
    retryAllowed: false,
    errorCode: 'OUTCOME_UNKNOWN',
  });
  assert.equal(readFileSync(sideEffectMarkerPath, 'utf8'), 'x');
  process.stdout.write(`${JSON.stringify({ ...result, sideEffectCount: 1 })}\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
