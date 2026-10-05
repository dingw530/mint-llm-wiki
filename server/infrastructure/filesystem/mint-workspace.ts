import path from 'node:path';
import { homedir } from 'node:os';

/**
 * 获取 Mint 本地工作空间的绝对路径。
 * @returns {string} 当前用户的 Mint 工作空间路径
 */
export function getMintWorkspacePath(): string {
  return path.join(homedir(), '.mint');
}
