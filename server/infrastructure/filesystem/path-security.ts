import * as path from 'path';

/**
 * 检查目标路径是否在允许的根目录范围内，防止路径穿越
 */
export function isPathSafe(root: string, target: string): boolean {
  if (!root || !target) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, target);
  return resolvedTarget.startsWith(resolvedRoot + path.sep) || resolvedTarget === resolvedRoot;
}
