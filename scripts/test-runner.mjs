#!/usr/bin/env node
/**
 * scripts/test-runner.mjs
 *
 * 运行 Vitest（单元测试），输出结构化 JSON 报告到 stdout。
 * Harness check-runner 可将此报告写入 HARNESS_FAILURE_FILE 供 AI editor 消费。
 *
 * 用法: node scripts/test-runner.mjs [vitest-args...]
 *
 * 输出 JSON 格式：
 * {
 *   "summary": { "total": 100, "passed": 95, "failed": 5, "durationMs": 3000 },
 *   "failures": [
 *     {
 *       "file": "services/foo.test.ts",
 *       "name": "suite > test case",
 *       "error": "expected 1 to be 2",
 *       "location": { "line": 42, "column": 5 },
 *       "code": "ERR_ASSERTION"
 *     }
 *   ],
 *   "rawOutput": "..."   // 完整 vitest --reporter=verbose 输出，供人工查看
 * }
 */

import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SERVER_DIR = join(ROOT, 'apps/server');

const vitestArgs = process.argv.slice(2);

function runVitestJson() {
  const outputDir = mkdtempSync(join(tmpdir(), 'mint-vitest-report-'));
  const outputFile = join(outputDir, 'vitest.json');
  const args = [
    '../scripts/with-node-version.cjs',
    'node',
    '../node_modules/vitest/vitest.mjs',
    'run',
    ...vitestArgs,
    '--poolOptions.threads.singleThread',
    '--reporter=json',
    `--outputFile=${outputFile}`,
  ];
  try {
    const result = spawnSync('node', args, {
      cwd: SERVER_DIR,
      encoding: 'utf-8',
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        AI_CHAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        AI_CHAT_DB_PATH: process.env.AI_CHAT_DB_PATH || '/tmp/ai-chat-test-runner.db',
      },
    });
    const report = readFileSync(outputFile, 'utf-8');
    rmSync(outputDir, { recursive: true, force: true });
    return {
      report,
      rawOutput: `${result.stdout || ''}\n${result.stderr || ''}`,
      exitCode: result.status ?? 1,
      error: result.error?.message || null,
    };
  } catch (err) {
    let report = '';
    try {
      report = readFileSync(outputFile, 'utf-8');
    } catch {
      /* runner failure before report creation */
    }
    rmSync(outputDir, { recursive: true, force: true });
    return {
      report,
      rawOutput: `${err.stdout || ''}\n${err.stderr || ''}`,
      exitCode: err.status ?? 1,
      error: err.message,
    };
  }
}

function parseFailures(vitestJson, rawOutput) {
  const report = typeof vitestJson === 'string' ? JSON.parse(vitestJson) : vitestJson;

  if (!report || !report.testResults) {
    // Try alternate vitest output format
    if (report.numTotalTests !== undefined) {
      // Simple format
      return {
        summary: {
          total: report.numTotalTests ?? 0,
          passed: report.numPassedTests ?? 0,
          failed: report.numFailedTests ?? 0,
          durationMs: Math.round(report.testDuration ?? 0),
        },
        failures: [],
        rawOutput,
      };
    }
    return null;
  }

  const summary = {
    total: report.numTotalTests ?? report.testResults.length,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    durationMs: Math.round(report.testDuration ?? 0),
  };

  const failures = [];
  for (const suite of report.testResults || []) {
    for (const test of suite.assertionResults || []) {
      if (test.status === 'failed') {
        failures.push({
          file: suite.name?.replace(/^.*[/\\]__tests__[/\\]/, '') || suite.name,
          name: test.fullName || test.title,
          error: test.failureMessages?.[0] || 'Unknown error',
          location: test.location || undefined,
        });
      }
    }
  }

  return { summary, failures, rawOutput };
}

// ── Main ──
const result = runVitestJson();
const { report, rawOutput, exitCode } = result;

let parsed;
try {
  if (!report) throw new Error(result.error || 'Vitest did not produce a JSON report');
  parsed = parseFailures(report, rawOutput);
} catch (parseErr) {
  // JSON parse failed — output raw failure info
  parsed = {
    summary: { total: 0, passed: 0, failed: 1, durationMs: 0 },
    failures: [
      {
        file: 'runner',
        name: 'test runner',
        error: `Failed to parse vitest output: ${parseErr.message}\n\nRaw output:\n${rawOutput.slice(0, 5000)}`,
      },
    ],
    rawOutput,
  };
}

// Write the report to stdout (captured by Harness check-runner)
process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');

// Exit code reflects test success/failure
process.exit(exitCode === 0 ? 0 : 1);
