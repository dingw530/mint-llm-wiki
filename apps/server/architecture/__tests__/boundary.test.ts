import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { describe, test, expect } from 'vitest';
import knownViolations from './known-violations.json';
import { collectMemoryDependencyEdges, findMemoryBoundaryViolations } from '../memoryBoundary.js';

// Server layer rules — each layer may only import from layers to its LEFT
const SERVER_LAYER_RULES: Record<string, string[]> = {
  types: [],
  migrations: ['types'],
  repositories: ['migrations', 'types'],
  services: ['repositories', 'types'],
  endpoints: ['services', 'middleware', 'types'],
  middleware: ['services', 'types'],
};

// Client layer rules
const CLIENT_LAYER_RULES: Record<string, string[]> = {
  types: [],
  services: ['types'],
  shared: ['services', 'types'],
  features: ['shared', 'services', 'types'],
  components: ['features', 'shared', 'types'],
};

const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/;

function getServerLayer(filePath: string): string | null {
  const match = filePath.match(/^([^/]+)\//);
  if (match && match[1] in SERVER_LAYER_RULES) return match[1];
  return null;
}

function getClientLayer(filePath: string): string | null {
  const match = filePath.match(/^client\/src\/([^/]+)\//);
  if (match && match[1] in CLIENT_LAYER_RULES) return match[1];
  return null;
}

function getLayerRules(filePath: string): {
  rules: Record<string, string[]>;
  layer: string | null;
} {
  const serverLayer = getServerLayer(filePath);
  if (serverLayer) return { rules: SERVER_LAYER_RULES, layer: serverLayer };

  const clientLayer = getClientLayer(filePath);
  if (clientLayer) return { rules: CLIENT_LAYER_RULES, layer: clientLayer };

  return { rules: {}, layer: null };
}

function resolveTargetLayer(importPath: string, rules: Record<string, string[]>): string | null {
  const normalized = importPath.replace(/^[@~#]\//, '');
  const segments = normalized.split('/');
  for (const layer of Object.keys(rules)) {
    if (segments.includes(layer)) return layer;
  }
  return null;
}

interface Violation {
  file: string;
  line: number;
  imports: string;
  from_layer: string;
  to_layer: string;
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = relative(process.cwd(), filePath);

  const { rules, layer: fromLayer } = getLayerRules(relPath);
  if (!fromLayer) return violations;

  let inTypeImport = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*import\s+type\s/.test(line)) inTypeImport = true;

    const match = line.match(FROM_RE);
    if (match && !inTypeImport) {
      const targetLayer = resolveTargetLayer(match[1], rules);
      if (targetLayer && !rules[fromLayer].includes(targetLayer) && targetLayer !== fromLayer) {
        violations.push({
          file: relPath,
          line: i + 1,
          imports: match[1],
          from_layer: fromLayer,
          to_layer: targetLayer,
        });
      }
    }

    if (inTypeImport && FROM_RE.test(line)) inTypeImport = false;
  }
  return violations;
}

function collectFiles(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '__tests__'].includes(entry.name)) {
      results.push(...collectFiles(fullPath, ext));
    } else if (ext.some((e) => entry.name.endsWith(e)) && !entry.name.includes('.test.')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Run from project root - adjust paths accordingly
const PROJECT_ROOT = join(process.cwd(), '..');

describe('Architecture Boundary Test', () => {
  const serverRoot = join(process.cwd(), '..', 'server');
  const serverFiles = collectFiles(join(PROJECT_ROOT, 'server'), ['.ts']);
  const clientFiles = collectFiles(join(PROJECT_ROOT, 'client/src'), ['.ts', '.tsx']);
  const allFiles = [...serverFiles, ...clientFiles];
  const allViolations = allFiles.flatMap(scanFile);

  test('no new architecture violations', () => {
    const knownSet = new Set(knownViolations.map((v) => `${v.file}:${v.imports}`));
    const newViolations = allViolations.filter((v) => !knownSet.has(`${v.file}:${v.imports}`));

    if (newViolations.length > 0) {
      const msg = newViolations
        .map(
          (v) =>
            `VIOLATION: ${v.file}:${v.line} imports ${v.imports} — ${v.from_layer} cannot import ${v.to_layer}. See docs/architecture/LAYERS.md`,
        )
        .join('\n');
      throw new Error(`New architecture violations found:\n${msg}`);
    }
  });

  test('violation count only shrinks (ratchet)', () => {
    expect(allViolations.length).toBeLessThanOrEqual(knownViolations.length);
  });

  test('Memory imports follow the domain public boundary', () => {
    const violations = findMemoryBoundaryViolations(
      collectMemoryDependencyEdges(serverRoot),
      serverRoot,
    );
    expect(violations).toEqual([]);
  });
});
