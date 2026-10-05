import {
  readBashSecuritySettings,
  writeBashSecuritySettings,
} from '../../infrastructure/config/bash-security-settings.js';

// ── 类型 ──

export interface BashSecurityConfig {
  blockedCommands: string[]; // 命令黑名单（glob/正则）
  blockedDirs: string[]; // 目录黑名单（绝对路径）
}

// ── 读写配置 ──

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function getConfig(): BashSecurityConfig {
  const raw = readBashSecuritySettings();
  return {
    blockedCommands: parseList(raw.bashBlockedCommands),
    blockedDirs: parseList(raw.bashBlockedDirs),
  };
}

function saveConfig(config: BashSecurityConfig): void {
  writeBashSecuritySettings({
    bashBlockedCommands: JSON.stringify(config.blockedCommands),
    bashBlockedDirs: JSON.stringify(config.blockedDirs),
  });
}

export function getBashSecurity(): BashSecurityConfig {
  return getConfig();
}

export function updateBashSecurity(config: BashSecurityConfig): void {
  saveConfig(config);
}

// ── 命令校验 ──

export interface CheckResult {
  allowed: boolean;
  reason?: string;
}

// 内置的硬编码黑名单
const BUILTIN_BLOCKED_PATTERNS = [
  { pattern: /^\s*(rm\s+(-rf?\s+)?\/|rm\s+(-rf?\s+)?\/\*)/, reason: '不允许删除根目录' },
  { pattern: /^\s*sudo\s+/, reason: '不允许使用 sudo' },
  { pattern: /^\s*chmod\s+777\s+/, reason: '不允许 chmod 777' },
  { pattern: /^\s*chown\s+/, reason: '不允许更改文件所有者' },
  { pattern: /^\s*dd\s+/, reason: '不允许直接磁盘写入' },
  { pattern: /^\s*mkfs\./, reason: '不允许格式化磁盘' },
  { pattern: /^\s*:\(\)\s*\{/, reason: '不允许 fork 炸弹' },
  { pattern: /^\s*>(\s+\/dev\/)?\/(sda|sdb|sdc|nvme|disk)/, reason: '不允许直接磁盘写入' },
  { pattern: /^\s*mv\s+\/\s+/, reason: '不允许移动根目录' },
  { pattern: /^\s*wget\s+.*\||^\s*curl\s+.*\|/, reason: '不允许从网络直接管道执行' },
];

export function checkCommand(command: string): CheckResult {
  // 1. 硬编码黑名单
  for (const { pattern, reason } of BUILTIN_BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason };
    }
  }

  // 2. 用户配置的命令黑名单
  const config = getConfig();
  for (const blocked of config.blockedCommands) {
    if (!blocked) continue;
    // 精确匹配或子串匹配
    if (command.includes(blocked)) {
      return { allowed: false, reason: `命令 "${blocked}" 已被用户加入黑名单` };
    }
  }

  // 3. 目录黑名单
  for (const dir of config.blockedDirs) {
    if (!dir) continue;
    if (command.includes(dir)) {
      return { allowed: false, reason: `目录 ${dir} 已被用户加入黑名单` };
    }
  }

  return { allowed: true };
}

/** Classifies Bash commands that must not use an unisolated fallback. */
export function isHighRiskBashCommand(command: string): boolean {
  return /(^|\s)(rm|mv|chmod|chown|sudo|kill|pkill|shutdown|reboot)\b|\/etc\/|\/var\/|\/Users\/|\/home\//i.test(
    command,
  );
}
