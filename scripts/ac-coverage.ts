#!/usr/bin/env tsx
/**
 * AC Coverage Checker — 验收标准→测试覆盖矩阵
 *
 * 用法:
 *   npx tsx scripts/ac-coverage.ts                              # 扫描所有 product-spec
 *   npx tsx scripts/ac-coverage.ts docs/changes/xxx/product-spec.md   # 指定单个
 *   npx tsx scripts/ac-coverage.ts --ci                          # CI 模式，覆盖率低于阈值退出 1
 *
 * 原理:
 *   1. 从 product-spec.md 解析 验收标准 章节中的 AC-xxx 列表
 *   2. 在 apps/server/ 下的各级 __tests__/ 中搜索匹配的 AC-xxx 引用（describe/it/test/runIf）
 *   3. 输出覆盖率矩阵
 *
 * 注意: AC 编号在各变更中独立命名，跨变更扫描时编号可能冲突（如不同变更都有 AC-001）。
 *       建议日常使用按单个变更扫描以获取准确结果。
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const SPEC_DIR = join(ROOT, 'docs', 'changes');
const WARN_THRESHOLD = 0.8; // 覆盖率低于 80% 时告警
const CI_FLAG = process.argv.includes('--ci');
const customPath = process.argv
  .slice(2)
  .find((a) => a.startsWith('docs/') || a.startsWith('/') || a.endsWith('product-spec.md'));

interface AcEntry {
  id: string;
  description: string;
}

interface CoverageResult {
  ac: AcEntry;
  matched: boolean;
  locations: string[];
}

let exitCode = 0;

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string) {
  const prefix = { INFO: '✓', WARN: '⚠', ERROR: '✗' }[level];
  console.log(`${prefix} ${msg}`);
  if (level === 'ERROR') exitCode = 1;
}

/**
 * 从 product-spec.md 中解析 AC 条目
 */
function parseAcEntries(specPath: string): AcEntry[] {
  const content = readFileSync(specPath, 'utf-8');
  const lines = content.split('\n');
  const entries: AcEntry[] = [];
  let inAcSection = false;

  for (const line of lines) {
    // 检测 "## 验收标准" 章节开始
    if (/^##\s+验收标准/.test(line)) {
      inAcSection = true;
      continue;
    }
    // 遇到下一个 ## 节标题则退出
    if (inAcSection && /^##\s/.test(line)) {
      inAcSection = false;
      continue;
    }

    if (inAcSection) {
      const match = line.match(/^-\s*(?:\[.\]\s*)?(?:\*\*)?(AC-\d+)(?:\*\*)?[：:]\s*(.+)/);
      if (match) {
        entries.push({ id: match[1], description: match[2].trim() });
      }
    }
  }

  return entries;
}

/**
 * 收集所有 product-spec 文件的路径
 */
function collectSpecPaths(): string[] {
  if (customPath) {
    const resolved = customPath.startsWith('/') ? customPath : join(ROOT, customPath);
    if (!statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
      log('ERROR', `指定的 product-spec 文件不存在: ${resolved}`);
      process.exit(1);
    }
    return [resolved];
  }

  // 扫描 docs/changes/*/product-spec.md
  const paths: string[] = [];
  try {
    const dirs = readdirSync(SPEC_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const specPath = join(SPEC_DIR, dir.name, 'product-spec.md');
      if (statSync(specPath, { throwIfNoEntry: false })?.isFile()) {
        paths.push(specPath);
      }
    }
  } catch {
    log('ERROR', `无法读取变更目录: ${SPEC_DIR}`);
    process.exit(1);
  }

  return paths;
}

/**
 * 在测试文件中搜索 AC 引用（使用 Node.js 原生 API，避免 shell 转义问题）
 */
function searchAcInTests(acId: string): { matched: boolean; locations: string[] } {
  const locations: string[] = [];
  const testDir = join(ROOT, 'apps/server');

  if (!statSync(testDir, { throwIfNoEntry: false })?.isDirectory()) {
    return { matched: false, locations: [] };
  }

  // AC 引用的正则模式：describe/it/test/runIf(...) 中的 AC-xxx
  const acPattern = new RegExp(`(describe|it|test|runIf\\([^)]+\\))\\s*\\(\\s*["']${acId}[：:]`);
  const acIdPattern = new RegExp(`${acId}[：:]`);

  function scanDir(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          scanDir(fullPath);
        }
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        // 先用快速搜索检查是否包含 AC 编号
        const content = readFileSync(fullPath, 'utf-8');
        if (!acIdPattern.test(content)) continue;

        // 逐行匹配
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(acPattern);
          if (match) {
            const testName = lines[i]
              .replace(/^\s*(describe|it|test|runIf\([^)]+\))\s*\(\s*['"]/, '')
              .replace(/['"],\s*.*$/, '')
              .trim();
            locations.push(`${relative(ROOT, fullPath)}:${i + 1} — ${testName}`);
          }
        }
      }
    }
  }

  scanDir(testDir);
  const unique = [...new Set(locations)];
  return { matched: unique.length > 0, locations: unique };
}

/**
 * 输出覆盖率矩阵
 */
function printMatrix(results: CoverageResult[]) {
  const idWidth = Math.max(...results.map((r) => r.ac.id.length), 7);
  const descWidth = Math.max(...results.map((r) => r.ac.description.length), 30);
  const line = `├${'─'.repeat(idWidth + 2)}┼${'─'.repeat(descWidth + 2)}┼${'─'.repeat(8)}┼${'─'.repeat(10)}┤`;
  const header = `│ ${'AC 编号'.padEnd(idWidth)} │ ${'描述'.padEnd(descWidth)} │ 测试引用 │ 状态  │`;
  const top = `┌${'─'.repeat(idWidth + 2)}┬${'─'.repeat(descWidth + 2)}┬${'─'.repeat(8)}┬${'─'.repeat(10)}┐`;
  const bottom = `└${'─'.repeat(idWidth + 2)}┴${'─'.repeat(descWidth + 2)}┴${'─'.repeat(8)}┴${'─'.repeat(10)}┘`;

  console.log(`\n${top}`);
  console.log(header);
  console.log(line);

  for (const r of results) {
    const status = r.matched ? '✅ 已覆盖' : '❌ 未覆盖';
    const ref = r.matched ? `yes` : `—`;
    const desc =
      r.ac.description.length > descWidth
        ? r.ac.description.slice(0, descWidth - 3) + '…'
        : r.ac.description;
    console.log(
      `│ ${r.ac.id.padEnd(idWidth)} │ ${desc.padEnd(descWidth)} │ ${ref.padEnd(6)} │ ${status.padEnd(8)} │`,
    );
  }
  console.log(bottom);
}

function printDetails(results: CoverageResult[]) {
  const unmatched = results.filter((r) => !r.matched);
  const matched = results.filter((r) => r.matched);

  if (matched.length > 0) {
    console.log('\n📎 测试引用详情:');
    for (const r of matched) {
      console.log(`  ${r.ac.id}:`);
      for (const loc of r.locations) {
        console.log(`    ${loc}`);
      }
    }
  }

  if (unmatched.length > 0) {
    console.log('\n⚠️  未覆盖的验收标准:');
    for (const r of unmatched) {
      console.log(`  ${r.ac.id}: ${r.ac.description}`);
    }
  }
}

function printSummary(results: CoverageResult[]) {
  const total = results.length;
  const covered = results.filter((r) => r.matched).length;
  const rate = total > 0 ? (covered / total) * 100 : 0;

  console.log(`\n📊 汇总: ${covered}/${total} AC 已覆盖 (${rate.toFixed(1)}%)`);

  if (rate < WARN_THRESHOLD * 100 && total > 0) {
    log('WARN', `覆盖率 ${rate.toFixed(1)}% 低于阈值 ${WARN_THRESHOLD * 100}%`);
    if (CI_FLAG) {
      log('ERROR', 'CI 模式下覆盖率不达标');
    }
  } else if (total === 0) {
    log('WARN', '未检测到验收标准，请确认 product-spec.md 格式');
  } else {
    log('INFO', '覆盖率达标');
  }
}

// ─── Main ────────────────────────────────────────────────────────

function main() {
  console.log('=== AC 覆盖率扫描 ===\n');

  const specPaths = collectSpecPaths();
  if (specPaths.length === 0) {
    log('WARN', '未找到 product-spec.md 文件');
    process.exit(exitCode);
  }

  log('INFO', `发现 ${specPaths.length} 个 product-spec`);
  let allResults: CoverageResult[] = [];

  for (const specPath of specPaths) {
    const acEntries = parseAcEntries(specPath);
    if (acEntries.length === 0) {
      continue;
    }

    const relPath = relative(ROOT, specPath);
    console.log(`\n── ${relPath} ──`);

    const results: CoverageResult[] = acEntries.map((ac) => {
      const { matched, locations } = searchAcInTests(ac.id);
      return { ac, matched, locations };
    });

    printMatrix(results);
    printDetails(results);
    allResults = [...allResults, ...results];
  }

  if (allResults.length > 0) {
    printSummary(allResults);
  } else {
    console.log('\n未找到包含验收标准的 product-spec。');
  }

  console.log(`\n=== 扫描完成 (exit code: ${exitCode}) ===`);
  process.exit(exitCode);
}

main();
