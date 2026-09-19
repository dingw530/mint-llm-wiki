import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

function trimOutput(value, maxLength = 12000) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function inferEvidenceLevel(check) {
  if (check.evidenceLevel) return check.evidenceLevel;
  if (check.name === 'browser-ac') return 'browser';
  if (check.name.includes('smoke')) return 'process-smoke';
  if (check.name === 'boundary') return 'integration';
  if (check.name === 'coverage') return 'static';
  return 'unit';
}

/** Try to parse stdout as structured test runner JSON. */
function tryParseStructuredOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object' && parsed.summary && Array.isArray(parsed.failures)) {
      return parsed;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/**
 * 执行一个显式命令并返回统一结果。
 * @param {import('./task.mjs').HarnessCheck} check
 * @param {Object} options
 * @param {string} options.rootDir
 * @param {string} options.artifactDir
 * @param {import('./task.mjs').HarnessTask} [options.task]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Object>}
 */
export async function runCheck(check, { rootDir, artifactDir, signal, task }) {
  const startedAt = performance.now();
  const timeoutMs = check.timeoutMs || 120000;
  const cwd = path.resolve(rootDir, check.cwd || '.');
  await fs.mkdir(artifactDir, { recursive: true });
  const commandLine = [check.command, ...(check.args || [])].join(' ');
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const result = await new Promise((resolve) => {
    const child = spawn(check.command, check.args || [], {
      cwd,
      env: {
        ...process.env,
        ...(task
          ? {
              HARNESS_CHANGE_ID: task.changeId,
              HARNESS_CHANGE_DIR: task.changeDir,
              HARNESS_ACCEPTANCE_CRITERIA: task.acceptanceCriteria.join(','),
            }
          : {}),
        HARNESS_ARTIFACT_DIR: path.join(artifactDir, check.name),
        ...(check.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      finish({ exitCode: null, signal: 'SIGTERM' });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish({ exitCode: null, error: error.message }));
    child.on('close', (exitCode, signalName) => finish({ exitCode, signal: signalName }));
    if (signal) {
      if (signal.aborted) child.kill('SIGTERM');
      signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    }
  });

  const durationMs = Math.round(performance.now() - startedAt);
  const status = result.exitCode === 0 && !timedOut ? 'passed' : 'failed';
  const failure =
    status === 'failed'
      ? result.error ||
        (timedOut
          ? `Timed out after ${timeoutMs}ms`
          : trimOutput(stderr || stdout || `Exited with code ${result.exitCode}`))
      : undefined;

  // Try to parse structured test failures (scripts/test-runner.mjs output)
  const parsed = tryParseStructuredOutput(stdout);
  if (parsed && parsed.failures && parsed.failures.length > 0) {
    const failurePath = path.join(artifactDir, `${check.name}-failures.json`);
    await fs.writeFile(failurePath, JSON.stringify(parsed.failures, null, 2), 'utf8');
  }

  const output = [
    `$ ${commandLine}`,
    `cwd: ${cwd}`,
    `status: ${status}`,
    `exitCode: ${result.exitCode ?? 'null'}`,
    '',
    stdout,
    stderr,
  ].join('\n');
  const logPath = path.join(artifactDir, `${check.name}.log`);
  await fs.writeFile(logPath, output, 'utf8');

  return {
    name: check.name,
    status,
    command: check.command,
    args: check.args || [],
    cwd,
    exitCode: result.exitCode,
    signal: result.signal || null,
    evidenceLevel: inferEvidenceLevel(check),
    invariants: check.invariants || [],
    durationMs,
    failure,
    logPath,
  };
}

/**
 * @param {import('./task.mjs').HarnessTask} task
 * @param {Object} options
 * @param {string} options.rootDir
 * @param {string} options.artifactDir
 * @returns {Promise<Object[]>}
 */
export async function runChecks(task, options) {
  const results = [];
  for (const check of task.checks) {
    const result = await runCheck(check, { ...options, task });
    results.push(result);
    if (result.status === 'failed') break;
  }
  return results;
}

export function allChecksPassed(results) {
  return results.length > 0 && results.every((result) => result.status === 'passed');
}
