import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHarnessTask } from '../task.mjs';
import { runLoop } from '../loop.mjs';

test('stops as blocked when a failing check has no editor', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-harness-loop-'));
  execFileSync('git', ['init', '--quiet'], { cwd: rootDir });
  const artifactDir = path.join(rootDir, 'run');
  await fs.mkdir(artifactDir, { recursive: true });
  const task = createHarnessTask({
    rootDir,
    changeId: 'demo',
    sdd: {
      changePath: rootDir,
      acceptanceCriteria: [],
      designDecisions: [],
      taskPlans: ['TP-001'],
    },
    config: {
      maxIterations: 2,
      checks: [{ name: 'bad', command: process.execPath, args: ['-e', 'process.exit(1)'] }],
    },
  });
  const result = await runLoop(task, { run: { runId: 'test', artifactDir }, rootDir });
  assert.equal(result.status, 'blocked');
  assert.equal(result.iterations, 1);
});

test('completes when the first check passes', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-harness-loop-'));
  execFileSync('git', ['init', '--quiet'], { cwd: rootDir });
  const artifactDir = path.join(rootDir, 'run');
  await fs.mkdir(artifactDir, { recursive: true });
  const task = createHarnessTask({
    rootDir,
    changeId: 'demo',
    sdd: {
      changePath: rootDir,
      acceptanceCriteria: [],
      designDecisions: [],
      taskPlans: ['TP-001'],
    },
    config: {
      maxIterations: 2,
      checks: [{ name: 'ok', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    },
  });
  const result = await runLoop(task, { run: { runId: 'test', artifactDir }, rootDir });
  assert.equal(result.status, 'completed');
  assert.equal(result.iterations, 1);
});

test('rechecks after an in-scope editor change', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-harness-loop-'));
  execFileSync('git', ['init', '--quiet'], { cwd: rootDir });
  await fs.writeFile(path.join(rootDir, 'target.txt'), 'before\n');
  execFileSync('git', ['add', 'target.txt'], { cwd: rootDir });
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'init'],
    { cwd: rootDir },
  );
  const artifactDir = path.join(rootDir, 'run');
  const task = createHarnessTask({
    rootDir,
    changeId: 'demo',
    sdd: {
      changePath: rootDir,
      acceptanceCriteria: [],
      designDecisions: [],
      taskPlans: ['TP-001'],
    },
    config: {
      maxIterations: 2,
      allowedPaths: ['target.txt'],
      checks: [
        {
          name: 'check',
          command: process.execPath,
          args: [
            '-e',
            'const fs=require("fs"); process.exit(fs.readFileSync("target.txt", "utf8").trim()==="after" ? 0 : 1)',
          ],
        },
      ],
    },
  });
  const result = await runLoop(task, {
    run: { runId: 'test-edit', artifactDir },
    rootDir,
    editCommand: [process.execPath, '-e', 'require("fs").writeFileSync("target.txt", "after\\n")'],
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.iterations, 2);
  assert.equal(result.history[0].diff.allowed, true);
});

test('stops at the configured iteration limit when edits do not fix the check', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-harness-loop-'));
  execFileSync('git', ['init', '--quiet'], { cwd: rootDir });
  const artifactDir = path.join(rootDir, 'run');
  await fs.mkdir(artifactDir, { recursive: true });
  const task = createHarnessTask({
    rootDir,
    changeId: 'demo',
    sdd: {
      changePath: rootDir,
      acceptanceCriteria: [],
      designDecisions: [],
      taskPlans: ['TP-001'],
    },
    config: {
      maxIterations: 2,
      allowedPaths: ['apps/client/'],
      checks: [{ name: 'bad', command: process.execPath, args: ['-e', 'process.exit(1)'] }],
    },
  });
  const result = await runLoop(task, {
    run: { runId: 'test', artifactDir },
    rootDir,
    editCommand: [process.execPath, '-e', 'process.exit(0)'],
  });
  assert.equal(result.status, 'max_iterations');
  assert.equal(result.iterations, 2);
});
