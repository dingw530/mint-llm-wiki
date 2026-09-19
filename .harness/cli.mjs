#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSddDocument } from './sdd-adapter.mjs';
import { createHarnessTask, validateTask } from './task.mjs';
import { createRun, appendSddExecutionRecord, writeRunTask } from './evidence.mjs';
import { runChecks, allChecksPassed } from './check-runner.mjs';
import { claimsPassed, evaluateClaims } from './claim-evaluator.mjs';
import { runLoop } from './loop.mjs';

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    result[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return result;
}

async function readConfig(rootDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(rootDir, '.harness', 'config.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function parseEditCommand(value) {
  if (!value) return undefined;
  const command = JSON.parse(value);
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((item) => typeof item !== 'string')
  ) {
    throw new Error('--edit-command must be a JSON string array, e.g. ["node","scripts/fix.mjs"]');
  }
  return command;
}

function parseJsonArray(value, flagName) {
  if (!value) return undefined;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${flagName} must be a JSON string array`);
  }
  return parsed;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'inspect';
  const rootDir = process.cwd();
  const changeId = args.change;
  if (!changeId)
    throw new Error('Usage: node .harness/cli.mjs <inspect|check|loop|verify> --change <id>');

  const sdd = await readSddDocument(rootDir, changeId);
  const config = await readConfig(rootDir);
  const cliAllowedPaths = parseJsonArray(args['allowed-paths'], '--allowed-paths');
  const cliProtectedPaths = parseJsonArray(args['protected-paths'], '--protected-paths');
  const cliChecks = args.checks ? JSON.parse(args.checks) : undefined;
  const task = validateTask(
    createHarnessTask({
      rootDir,
      changeId,
      sdd,
      config: {
        ...config,
        allowedPaths: cliAllowedPaths || config.allowedPaths,
        protectedPaths: cliProtectedPaths || config.protectedPaths,
        checks: cliChecks || config.checks,
        maxIterations: args['max-iterations']
          ? Number(args['max-iterations'])
          : config.maxIterations,
      },
    }),
  );

  if (command === 'inspect') {
    printResult({
      command,
      sdd: {
        changeId: sdd.changeId,
        changePath: sdd.changePath,
        currentTp: sdd.currentTp,
        acceptanceCriteria: sdd.acceptanceCriteria,
        designDecisions: sdd.designDecisions,
        taskPlans: sdd.taskPlans,
        verification: task.verification,
      },
      task,
    });
    return;
  }

  if (args['dry-run']) {
    printResult({
      command,
      changeId,
      currentTp: task.currentTp,
      checks: task.checks,
      allowedPaths: task.allowedPaths,
      protectedPaths: task.protectedPaths,
      maxIterations: task.maxIterations,
    });
    return;
  }

  const run = await createRun(rootDir, changeId);
  await writeRunTask(run, task);
  if (command === 'check' || command === 'verify') {
    const results = await runChecks(task, { rootDir, artifactDir: run.artifactDir });
    const verification = evaluateClaims(task, results);
    await fs.writeFile(
      path.join(run.artifactDir, 'claim-verification.json'),
      `${JSON.stringify(verification, null, 2)}\n`,
      'utf8',
    );
    const checksPassed = allChecksPassed(results);
    const allowLegacy = Boolean(args['allow-legacy'] || task.verification.allowLegacy);
    const claimsPassedForRun =
      claimsPassed(verification) || (task.verification.mode === 'legacy' && allowLegacy);
    const result = {
      command,
      runId: run.runId,
      status: checksPassed && claimsPassedForRun ? 'completed' : 'failed',
      results,
      verification,
      artifactDir: run.artifactDir,
    };
    printResult(result);
    if (args.writeback) {
      await appendSddExecutionRecord(rootDir, changeId, {
        runId: run.runId,
        currentTp: task.currentTp,
        iterations: 1,
        status: result.status,
        checkSummary: `${results.map((item) => `${item.name}:${item.status}`).join(', ')}, claims:${verification.status}`,
      });
    }
    if (result.status !== 'completed') process.exitCode = 1;
    return;
  }

  if (command !== 'loop') throw new Error(`Unknown Harness command: ${command}`);
  const result = await runLoop(task, {
    run,
    rootDir,
    editCommand: parseEditCommand(args['edit-command']),
    dryRun: Boolean(args['dry-run']),
  });
  const output = { command, runId: run.runId, artifactDir: run.artifactDir, ...result };
  printResult(output);
  if (args.writeback) {
    await appendSddExecutionRecord(rootDir, changeId, {
      runId: run.runId,
      currentTp: task.currentTp,
      iterations: result.iterations,
      status: result.status,
      checkSummary: `${result.lastResults.map((item) => `${item.name}:${item.status}`).join(', ')}, claims:${result.lastVerification?.status || 'UNVERIFIED'}`,
    });
  }
  if (result.status !== 'completed') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Harness error: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
