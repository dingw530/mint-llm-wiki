// ── 统一日志模块 ──
// 提供结构化 JSON 日志输出到 stdout，不引入外部依赖
// 支持日志级别过滤（AI_CHAT_LOG_LEVEL）、requestId 追踪、耗时记录

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// 全局过滤级别：从环境变量读取，默认 info
const GLOBAL_LOG_LEVEL: LogLevel = (process.env.AI_CHAT_LOG_LEVEL as LogLevel) || 'info';
const MIN_LEVEL = LOG_LEVELS[GLOBAL_LOG_LEVEL] ?? 1;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  requestId?: string;
  duration?: number;
  data?: Record<string, unknown>;
}

export class Logger {
  constructor(private module: string) {}

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= MIN_LEVEL;
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      module: this.module,
      message,
      data,
    });
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      module: this.module,
      message,
      data,
    });
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      module: this.module,
      message,
      data,
    });
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      module: this.module,
      message,
      data,
    });
  }

  // 记录操作耗时：timer 为 performance.now() 的起始值，label 为识别标签
  // 使用方式：const start = performance.now(); ...; log.duration('db.query', start);
  duration(label: string, start: number, data?: Record<string, unknown>): void {
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      module: this.module,
      message: label,
      duration: elapsed,
      data,
    });
  }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
