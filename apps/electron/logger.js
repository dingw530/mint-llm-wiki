const fs = require('fs');
const path = require('path');

let logStream = null;

function init(logDir) {
  if (logStream) return;

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logPath = path.join(logDir, 'app.log');
  logStream = fs.createWriteStream(logPath, { flags: 'a' });

  // 启动时写入分隔线，方便区分每次启动
  write('━'.repeat(60));
  write(`App started at ${new Date().toISOString()}`);
  write(`Electron version: ${process.versions.electron || 'N/A'}`);
  write(`Node version: ${process.versions.node}`);
  write(`Platform: ${process.platform} ${process.arch}`);
  write(`App path: ${process.resourcesPath || __dirname}`);
  write(`isPackaged: ${require('electron').app.isPackaged}`);
  write('━'.repeat(60));

  return logPath;
}

function write(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;

  // 同时输出到控制台（开发时有用）
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }

  if (logStream) {
    logStream.write(line + '\n');
  }
}

function info(msg)  { write(msg, 'INFO'); }
function warn(msg)  { write(msg, 'WARN'); }
function error(msg) { write(msg, 'ERROR'); }
function debug(msg) { write(msg, 'DEBUG'); }

// 确保日志落盘后再退出
function close() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

module.exports = { init, info, warn, error, debug, close };
