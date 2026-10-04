import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectRoutingDependencies } from '../routingBoundary.js';

/**
 * Collect all TypeScript source paths below a directory.
 * @param directory Root directory to scan.
 * @returns Absolute paths for TypeScript and TSX sources.
 */
function collectTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(target));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(target);
  }
  return files;
}

describe('Application services migration boundary', () => {
  it('leaves no TypeScript source or imports in the retired API service layer', () => {
    const serverRoot = path.resolve(process.cwd());
    const edges = collectRoutingDependencies(serverRoot);
    const legacyFiles = edges.filter(
      (edge) =>
        edge.importer.startsWith('services/api/') || edge.target.startsWith('services/api/'),
    );
    const legacySources = collectTypeScriptFiles(path.join(serverRoot, 'services/api'));
    expect(legacySources).toEqual([]);
    expect(legacyFiles).toEqual([]);
  });

  it('uses kebab-case filenames for migrated application TypeScript modules', () => {
    const serverRoot = path.resolve(process.cwd());
    const applicationFiles = collectTypeScriptFiles(path.join(serverRoot, 'application'));
    const nonKebabFiles = applicationFiles.filter(
      (file) => !/(?:^|\/)[a-z0-9]+(?:-[a-z0-9]+)*(?:\.test)?\.tsx?$/.test(file),
    );
    expect(nonKebabFiles).toEqual([]);
  });
});
