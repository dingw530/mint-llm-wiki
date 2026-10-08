// ── 统一日志模块 ──
// 提供人类可读或结构化 JSON 日志输出到 stdout，不引入外部依赖
// AI_CHAT_LOG_FORMAT=json|pretty 控制格式；开发环境默认 pretty，其他环境默认 JSON
// 支持日志级别过滤（AI_CHAT_LOG_LEVEL）、requestId 追踪、耗时记录

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// 全局过滤级别：从环境变量读取，默认 info
const GLOBAL_LOG_LEVEL = parseLogLevel(process.env.AI_CHAT_LOG_LEVEL);
const MIN_LEVEL = LOG_LEVELS[GLOBAL_LOG_LEVEL] ?? 1;
const GLOBAL_LOG_FORMAT = parseLogFormat(process.env.AI_CHAT_LOG_FORMAT, process.env.NODE_ENV);

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
  constructor(
    private module: string,
    private format: LogFormat = GLOBAL_LOG_FORMAT,
  ) {}

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= MIN_LEVEL;
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;
    const output = this.format === 'json' ? JSON.stringify(entry) : formatHumanLogEntry(entry);
    process.stdout.write(`${output}\n`);
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

/** Parses the configured log level and safely falls back to info. */
function parseLogLevel(value: string | undefined): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
  return 'info';
}

/** Uses readable output in development and structured JSON in other environments. */
function parseLogFormat(value: string | undefined, nodeEnv: string | undefined): LogFormat {
  if (value === 'json' || value === 'pretty') return value;
  return nodeEnv === 'development' ? 'pretty' : 'json';
}

/** Formats one structured entry as a readable line without discarding its fields. */
function formatHumanLogEntry(entry: LogEntry): string {
  const time = entry.timestamp.replace('T', ' ');
  const level = entry.level.toUpperCase().padEnd(5);
  const module = entry.module ? `[${entry.module}]` : '';
  const message = formatMessage(entry);
  const fields = formatFields(entry);
  return `${time} ${level} ${module} ${message}${fields ? ` ${fields}` : ''}`.trim();
}

/** Rewrites standard machine event names as short readable phrases. */
function formatMessage(entry: LogEntry): string {
  if (entry.module === 'tool-audit' && entry.message === 'tool_invocation_event') {
    const event = entry.data?.event;
    if (typeof event === 'string') return `tool ${event}`;
  }
  return entry.message.replaceAll('_', ' ');
}

/** Renders standard log metadata and data properties as labeled fields. */
function formatFields(entry: LogEntry): string {
  const fields: string[] = [];
  if (entry.requestId) fields.push(`requestId=${formatValue(entry.requestId)}`);
  if (entry.duration !== undefined) fields.push(`duration=${formatDuration(entry.duration)}`);
  for (const [key, value] of Object.entries(entry.data || {})) {
    if (entry.module === 'tool-audit' && key === 'event') continue;
    fields.push(`${key}=${formatValue(value)}`);
  }
  return fields.join(' ');
}

/** Renders nested values compactly and bounds large strings, arrays, and objects. */
function formatValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') return JSON.stringify(truncate(value, 240));
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    const rendered = value.slice(0, 6).map((item) => formatValue(item, depth + 1));
    const extraCount = value.length - rendered.length;
    return `[${rendered.join(', ')}${extraCount > 0 ? `, +${extraCount} more` : ''}]`;
  }
  if (typeof value === 'object') {
    if (depth >= 2) return '{…}';
    const entries = Object.entries(value).slice(0, 6);
    const rendered = entries.map(([key, item]) => `${key}: ${formatValue(item, depth + 1)}`);
    const extraCount = Object.keys(value).length - entries.length;
    return `{${rendered.join(', ')}${extraCount > 0 ? `, +${extraCount} more` : ''}}`;
  }
  return String(value);
}

/** Formats a duration in milliseconds for human-readable output. */
function formatDuration(milliseconds: number): string {
  return `${Math.round(milliseconds * 100) / 100}ms`;
}

/** Truncates long string values so a single log event stays readable. */
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}
