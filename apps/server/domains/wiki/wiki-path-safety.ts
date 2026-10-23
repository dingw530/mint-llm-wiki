import * as path from 'node:path';

/** Check that a Wiki relative path resolves below its configured root. */
export function isWikiRelativePathSafe(root: string, target: string): boolean {
  if (!root || !target) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, target);
  return resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`) || resolvedTarget === resolvedRoot;
}
