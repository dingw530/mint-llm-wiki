import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { captureWorktree, evaluateDiff } from './diff-policy.mjs';
import { allChecksPassed, runChecks } from './check-runner.mjs';
import { claimsPassed, evaluateClaims } from './claim-evaluator.mjs';
import { writeIteration, writeJson } from './evidence.mjs';

function runEditor(command, { rootDir, taskFile, failureFile, iteration, runDir }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: rootDir,
      env: {
        ...process.env,
        HARNESS_TASK_FILE: taskFile,
        HARNESS_FAILURE_FILE: failureFile,
        HARNESS_ITERATION: String(iteration),
        HARNESS_RUN_DIR: runDir,
      },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code || 0));
  });
}

/**
 * 执行有限轮次的测试-编辑-测试循环。
 * @param {import('./task.mjs').HarnessTask} task
 * @param {Object} options
 * @param {Object} options.run
 * @param {string} options.rootDir
 * @param {string[]} [options.editCommand]
 * @param {boolean} [options.dryRun]
 */
export async function runLoop(task, { run, rootDir, editCommand, dryRun = false }) {
  const before = await captureWorktree(rootDir);
  const history = [];
  let status = 'max_iterations';
  let lastResults = [];
  let lastVerification = null;

  for (let iteration = 1; iteration <= task.maxIterations; iteration += 1) {
    const iterationDir = path.join(run.artifactDir, `iteration-${iteration}`);
    const results = await runChecks(task, { rootDir, artifactDir: iterationDir });
    lastResults = results;
    lastVerification = evaluateClaims(task, results);
    await writeJson(path.join(iterationDir, 'claim-verification.json'), lastVerification);
    const passed =
      allChecksPassed(results) &&
      (task.verification.mode !== 'claims' || claimsPassed(lastVerification));
    const record = { iteration, results, verification: lastVerification, passed };

    if (passed) {
      status = 'completed';
      history.push(record);
      await writeIteration(run, iteration, record);
      break;
    }

    if (!editCommand || dryRun) {
      status = 'blocked';
      record.reason = dryRun
        ? 'dry-run: edit command was not executed'
        : 'no edit command configured';
      history.push(record);
      await writeIteration(run, iteration, record);
      break;
    }

    const failureFile = path.join(iterationDir, 'failure.json');
    const taskFile = `${run.artifactDir}/task.json`;

    // Merge structured test failures from check results
    const structuredFailures = results.flatMap((r) => {
      const fPath = path.join(iterationDir, `${r.name}-failures.json`);
      try {
        return JSON.parse(fs.readFileSync(fPath, 'utf8'));
      } catch {
        return [];
      }
    });
    await writeJson(failureFile, {
      iteration,
      results,
      verification: lastVerification,
      structuredFailures,
    });
    const editExitCode = await runEditor(editCommand, {
      rootDir,
      taskFile,
      failureFile,
      iteration,
      runDir: run.artifactDir,
    });
    const after = await captureWorktree(rootDir);
    const artifactPath = path.relative(rootDir, run.artifactDir).replaceAll(path.sep, '/');
    const diff = evaluateDiff(before, after, task.allowedPaths, task.protectedPaths, [
      `${artifactPath}/`,
    ]);
    record.editExitCode = editExitCode;
    record.diff = diff;

    if (editExitCode !== 0) {
      status = 'blocked';
      record.reason = `editor exited with code ${editExitCode}`;
      history.push(record);
      await writeIteration(run, iteration, record);
      break;
    }
    if (!diff.allowed) {
      status = 'blocked';
      record.reason = 'diff policy rejected editor changes';
      history.push(record);
      await writeIteration(run, iteration, record);
      break;
    }
    history.push(record);
    await writeIteration(run, iteration, record);
  }

  return {
    status,
    iterations: history.length,
    history,
    lastResults,
    lastVerification,
    changedPaths: history.at(-1)?.diff?.changedPaths || [],
  };
}
