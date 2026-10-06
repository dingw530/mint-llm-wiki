#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changeId = readArgument('--change') || process.env.HARNESS_CHANGE_ID;
const staticOnly = process.argv.includes('--static-only');

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runCommand(name, command, args, options = {}) {
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs || 180_000,
  });
  return {
    name,
    command,
    args,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    durationMs: Math.round(performance.now() - startedAt),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null,
  };
}

function runStaticChecks() {
  const commands = [
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['boundary', 'npm', ['run', '--workspace=mint-server', 'test:boundary']],
    ['server-build', 'npm', ['run', '--workspace=mint-server', 'build']],
    ['electron-bundle', 'npm', ['run', '--workspace=mint-server', 'build:bundle']],
    ['mcp-bundle', 'npm', ['run', '--workspace=mint-server', 'build:mcp']],
    ['client-build', 'npm', ['run', '--workspace=mint-client', 'build']],
  ];
  return commands.map(([name, command, args]) => runCommand(name, command, args));
}

function parseChecks() {
  const checksPath = path.join(root, 'docs', 'changes', changeId, 'harness-checks.json');
  return JSON.parse(fs.readFileSync(checksPath, 'utf8'));
}

function runFullChecks() {
  const checks = parseChecks();
  const evidenceDir = path.join(root, 'docs/changes', changeId, 'evidence/implementation/TP-008');
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const check of checks) {
    if (check.name === 'memory-quality') {
      check.env = {
        ...(check.env || {}),
        MINT_MEMORY_QUALITY_REPORT_PATH: path.join(evidenceDir, 'quality-report.json'),
      };
    }
  }
  const startedAt = new Date().toISOString();
  const args = [
    path.join(root, '.harness/cli.mjs'),
    'verify',
    '--change',
    changeId,
    '--checks',
    JSON.stringify(checks),
    '--writeback',
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 1_200_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  let verificationResult;
  try {
    verificationResult = JSON.parse(result.stdout || '{}');
  } catch {
    verificationResult = { status: 'failed', parseError: true };
  }
  const report = {
    changeId,
    startedAt,
    completedAt: new Date().toISOString(),
    status: result.status === 0 && verificationResult.status === 'completed' ? 'passed' : 'failed',
    harnessRunId: verificationResult.runId || null,
    claimStatus: verificationResult.verification?.status || 'UNVERIFIED',
    artifactDir: verificationResult.artifactDir || null,
    error: result.error?.message || null,
  };
  fs.writeFileSync(
    path.join(evidenceDir, 'memory-verification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

if (staticOnly) {
  const results = runStaticChecks();
  console.log(
    JSON.stringify(
      { status: results.every(({ status }) => status === 'passed') ? 'passed' : 'failed', results },
      null,
      2,
    ),
  );
  if (results.some(({ status }) => status !== 'passed')) process.exitCode = 1;
} else if (!changeId) {
  throw new Error(
    'Usage: node scripts/memory-verification.mjs --static-only | --change <change-id>',
  );
} else {
  runFullChecks();
}
