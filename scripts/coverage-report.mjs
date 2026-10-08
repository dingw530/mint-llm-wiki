#!/usr/bin/env node
/**
 * scripts/coverage-report.mjs
 *
 * 在变更结束时输出覆盖率摘要到 traceability.md。
 *
 * 用法: node scripts/coverage-report.mjs <change-dir>
 * 示例: node scripts/coverage-report.mjs docs/changes/2026-07-26-wiki-search-foundation
 *
 * 前提: 运行前保证 `npm run test:coverage -w mint-server` 可正常输出覆盖率。
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function getChangeId(changeDir) {
  return changeDir.replace(/\/$/, '').split('/').pop();
}

function appendToTraceability(changeDir, summary) {
  const tracePath = join(changeDir, 'traceability.md');
  if (!existsSync(tracePath)) {
    console.log(`⚠ traceability.md 不存在: ${tracePath}`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const changeId = getChangeId(changeDir);
  const line = `| ${changeId} | ${today} | ${summary} |`;

  let content = readFileSync(tracePath, 'utf-8');

  if (content.includes('## 测试趋势')) {
    content = content.replace(/(## 测试趋势[\s\S]*?)(?=\n## |$)/, (match, section) => {
      const rows = section.trim().split('\n');
      const existingIdx = rows.findIndex((r) => r.trim().startsWith(`| ${changeId} `));
      if (existingIdx >= 0) {
        rows[existingIdx] = line;
        return rows.join('\n');
      }
      return section.trimEnd() + '\n' + line;
    });
  } else {
    const table = [
      '',
      '## 测试趋势',
      '',
      '| 变更 | 日期 | 覆盖率摘要 |',
      '|------|------|-----------|',
      line,
      '',
    ].join('\n');
    content = content.trimEnd() + table;
  }

  writeFileSync(tracePath, content);
  console.log(`✅ 覆盖率已写入 ${tracePath}`);
}

// ── Main ──

const changeDir = process.argv[2];
if (!changeDir) {
  console.error('用法: node scripts/coverage-report.mjs <change-dir>');
  process.exit(1);
}

if (!existsSync(changeDir)) {
  console.error(`目录不存在: ${changeDir}`);
  process.exit(1);
}

// Run coverage and capture output
console.log('⏳ 运行覆盖率检测...');
try {
  const output = execSync('npx vitest run --coverage', {
    cwd: join(process.cwd(), 'apps/server'),
    encoding: 'utf-8',
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });

  // Extract the coverage summary table — last section with pipe characters
  const lines = output.split('\n').filter((l) => l.startsWith('|'));
  const summaryLines = lines.filter((l) => l.includes('services/'));
  if (summaryLines.length > 0) {
    const summary = summaryLines.map((l) => `\`${l.trim()}\``).join('; ');
    appendToTraceability(changeDir, summary);
  } else {
    console.log('⚠ 未找到覆盖率指标行');
    console.log('--- 最后 20 行输出 ---');
    console.log(output.split('\n').slice(-20).join('\n'));
  }
} catch (err) {
  console.error('❌ 覆盖率运行失败（可能因 better-sqlite3 本地模块版本不匹配）');
  console.error('   可以在 CI 中查看完整覆盖率报告');
  // Write a placeholder row
  appendToTraceability(changeDir, '_覆盖率报告不可用_');
  process.exit(1);
}
