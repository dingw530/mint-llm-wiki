import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

let logFile: string | null = null;

function init(): string {
  if (logFile) return logFile;

  // 从 DB 路径推导日志目录（DB 在 userData 下）
  const dbPath = process.env.AI_CHAT_DB_PATH;
  let logDir: string;
  if (dbPath) {
    logDir = join(dirname(dbPath), 'logs');
  } else {
    logDir = join(process.cwd(), 'logs');
  }

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  logFile = join(logDir, 'server.log');
  return logFile;
}

function write(level: string, message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}`;

  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }

  if (logFile || init()) {
    try {
      appendFileSync(logFile!, line + '\n', 'utf-8');
    } catch {
      // 写日志失败不应影响主流程
    }
  }
}

export const log = {
  info(msg: string) {
    write('INFO', msg);
  },
  warn(msg: string) {
    write('WARN', msg);
  },
  error(msg: string) {
    write('ERROR', msg);
  },
  debug(msg: string) {
    write('DEBUG', msg);
  },
};
