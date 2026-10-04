import * as path from 'path';
import * as settingsService from '../../application/settings/settings-service.js';

/**
 * 检查目标路径是否在允许的根目录范围内，防止路径穿越
 */
export function isPathSafe(root: string, target: string): boolean {
  if (!root || !target) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, target);
  return resolvedTarget.startsWith(resolvedRoot + path.sep) || resolvedTarget === resolvedRoot;
}

/**
 * 获取配置的 Wiki 路径，若未配置则返回 null
 */
export function getWikiPath(): string | null {
  const settings = settingsService.getAiSettings();
  return settings.wikiPath || null;
}
