const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const logger = require('./logger');
const { registerElectronIpcHandlers } = require('./ipc');

let mainWindow = null;
let serverBundlePromise = null;
let electronServiceBootstrapPromise = null;
let electronShutdownPromise = null;
let electronShutdownComplete = false;

const isDev = !app.isPackaged;
if (isDev) process.env.NODE_ENV = 'development';

// ── 尽早初始化日志（在 app ready 之前就准备好日志路径） ──

const MINT_DIR = path.join(os.homedir(), '.mint');
const MINT_ENV_KEYS = new Set([
  'AI_CHAT_ENCRYPTION_KEY',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
  'MINT_LANGFUSE_ENABLED',
  'MINT_LANGFUSE_ENVIRONMENT',
  'MINT_LANGFUSE_CAPTURE_CONTENT',
  'LANGFUSE_DEBUG',
]);

function getLogDir() {
  try {
    return path.join(MINT_DIR, 'logs');
  } catch {
    return path.join(__dirname, 'logs');
  }
}

// ── 全局错误捕获（在日志初始化后注册） ──

function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION: ${err.message}`);
    logger.error(`Stack: ${err.stack}`);
    logger.close();
    app.quit();
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`UNHANDLED REJECTION: ${reason}`);
    if (reason && reason.stack) {
      logger.error(`Stack: ${reason.stack}`);
    }
  });

  app.on('render-process-gone', (event, webContents, details) => {
    logger.error(`RENDER PROCESS GONE: reason=${details.reason}, exitCode=${details.exitCode}`);
  });

  app.on('child-process-gone', (event, details) => {
    logger.error(
      `CHILD PROCESS GONE: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}`,
    );
  });
}

// ── 路径辅助 ──

function getClientDistPath() {
  return path.join(__dirname, 'client-dist');
}

function getDbPath() {
  return path.join(MINT_DIR, 'data.db');
}

// ── 加密密钥管理（首次启动自动生成，持久化到 .mint/.env） ──

function getEnvFilePath() {
  return path.join(MINT_DIR, '.env');
}

function loadOrCreateEncryptionKey() {
  const envPath = getEnvFilePath();
  const providedByProcess = Boolean(process.env.AI_CHAT_ENCRYPTION_KEY);

  loadMintEnvironment(envPath);
  if (process.env.AI_CHAT_ENCRYPTION_KEY) {
    logger.info(
      `AI_CHAT_ENCRYPTION_KEY loaded from ${providedByProcess ? 'system environment' : '.env file'}`,
    );
    return;
  }

  const key = crypto.randomBytes(32).toString('hex');
  logger.info('Generated new encryption key');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8').trimEnd() : '';
  fs.writeFileSync(
    envPath,
    `${existing}${existing ? '\n' : ''}AI_CHAT_ENCRYPTION_KEY=${key}\n`,
    'utf-8',
  );
  logger.info(`Encryption key saved to: ${envPath}`);
  process.env.AI_CHAT_ENCRYPTION_KEY = key;
}

/** Loads only approved Mint runtime variables from the user's ~/.mint/.env file. */
function loadMintEnvironment(envPath) {
  if (!fs.existsSync(envPath)) return;

  logger.info(`Minting environment: ${envPath}`);
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !MINT_ENV_KEYS.has(match[1]) || process.env[match[1]]) continue;
    process.env[match[1]] = unquoteEnvValue(match[2]);
  }
}

function unquoteEnvValue(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// ── Server 生命周期（in-process：导入 ESM 模块启动 Express） ──

async function startServer() {
  logger.info('Starting server setup...');

  if (isDev) {
    logger.info('Dev mode — assuming external server on port 3001');
    return 3001;
  }

  loadOrCreateEncryptionKey();
  process.env.AI_CHAT_DB_PATH = getDbPath();
  process.env.AI_CHAT_CLIENT_DIST = getClientDistPath();
  process.env.NODE_ENV = 'production';

  const bundle = await getServerBundle();
  const actualPort = await bundle.startServer();
  logger.info(`Server started on port ${actualPort}`);
  return actualPort;
}

// ── IPC Handlers：直调服务层（绕过 HTTP） ──

let services = {};

async function getServerBundle() {
  if (serverBundlePromise) return serverBundlePromise;

  const bundlePath = isDev
    ? path.join(__dirname, '..', 'server', 'dist', 'electron-bundle.js')
    : path.join(__dirname, 'server-dist', 'index.js');

  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Server bundle not found: ${bundlePath}`);
  }

  logger.info(`Loading server bundle: ${bundlePath}`);

  serverBundlePromise = import(`file://${bundlePath}`).catch((err) => {
    serverBundlePromise = null;
    throw err;
  });

  return serverBundlePromise;
}

async function loadElectronServiceBootstrap() {
  if (electronServiceBootstrapPromise) return electronServiceBootstrapPromise;

  const bootstrapPath = isDev
    ? path.join(__dirname, 'services', 'bootstrap.js')
    : path.join(__dirname, 'services', 'bootstrap.js');

  if (!fs.existsSync(bootstrapPath)) {
    throw new Error(`Electron service bootstrap not found: ${bootstrapPath}`);
  }

  electronServiceBootstrapPromise = import(`file://${bootstrapPath}`).catch((err) => {
    electronServiceBootstrapPromise = null;
    throw err;
  });

  return electronServiceBootstrapPromise;
}

async function loadServiceModules() {
  let bundle;
  try {
    bundle = await getServerBundle();
  } catch (err) {
    logger.error(`Failed to load server bundle: ${err.message}`);
    return false;
  }

  services = {
    msgSvc: bundle.messageService,
    convSvc: bundle.conversationService,
    settSvc: bundle.settingsService,
    epSvc: bundle.endpointService,
    memSvc: bundle.memoryService,
    sinkMod: bundle,
    mcpRepo: bundle.mcpServerRepository,
    mcpSvc: { mcpService: bundle.mcpService },
    skillSvc: bundle.skillService,
    bashSecurity: bundle.bashSecurityService,
    wikiSvc: bundle.wikiService,
    graphSvc: bundle.graphService,
    // For generateTitle / parseFile / compileSource
    aiProxy: bundle,
    fileParseService: bundle,
    wikiCompiler: bundle,
    wikiIngestionJobService: bundle.wikiIngestionJobService,
    wikiVectorBackfillService: bundle.wikiVectorBackfillService,
    ingestionA2ui: bundle.ingestionA2ui,
    messageRepository: bundle.messageRepository,
    endpointRegistry: bundle.endpointRegistry,
    registerIpcHandlers: bundle.registerIpcHandlers,
    conversationsIpcOnlyEndpoints: bundle.conversationsIpcOnlyEndpoints,
  };
  logger.info('Service modules loaded');

  try {
    const bootstrap = await loadElectronServiceBootstrap();
    if (bootstrap?.registerElectronServices) {
      bootstrap.registerElectronServices(bundle);
      logger.info('Electron service bootstrap registered');
    }
  } catch (err) {
    logger.warn(`Electron service bootstrap skipped: ${err.message}`);
  }

  // 启动时扫描技能
  if (services.skillSvc) {
    services.skillSvc
      .listSkills()
      .catch((err) => logger.error('Skill scan failed: ' + err.message));
  }

  return true;
}

function setupIpcHandlers() {
  [
    'settings',
    'agents',
    'conversations',
    'endpoints',
    'memories',
    'mcp-servers',
    'bash-security',
    'skills',
    'graph',
    'wiki',
  ].forEach(registerEndpointGroupIpcHandlers);
  registerIpcDescriptorGroup('conversations-ipc-only', services.conversationsIpcOnlyEndpoints);
  registerElectronIpcHandlers({
    ipcMain,
    services,
    dialog,
    fs,
    path,
    shell,
    logger,
    getMainWindow: () => mainWindow,
  });

  logger.info('IPC handlers registered');
}

/**
 * 使用服务端 endpoint 定义注册一组标准 IPC handlers。
 *
 * Electron 专属能力（如 event、dialog、文件任务）仍由 main.js 手动注册，
 * 这里只接入不依赖 Electron 上下文的请求-响应型 endpoint。
 *
 * @param {string} resource endpoint 资源名
 */
function registerEndpointGroupIpcHandlers(resource) {
  if (!services.endpointRegistry || !services.registerIpcHandlers) {
    throw new Error('Endpoint IPC registry is not loaded');
  }

  const descriptors = services.endpointRegistry.getByResource(resource);
  services.registerIpcHandlers(descriptors, services, ipcMain);
  logger.info(`Endpoint IPC handlers registered: ${resource} (${descriptors.length})`);
}

/**
 * 注册不参与 HTTP 路由的 IPC 专属 endpoint 定义。
 *
 * @param {string} name 注册组名称
 * @param {Array<object>} descriptors endpoint 描述
 */
function registerIpcDescriptorGroup(name, descriptors) {
  if (!Array.isArray(descriptors)) {
    throw new Error(`IPC endpoint descriptors are not loaded: ${name}`);
  }
  services.registerIpcHandlers(descriptors, services, ipcMain);
  logger.info(`IPC-only endpoint handlers registered: ${name} (${descriptors.length})`);
}

// ── 窗口管理 ──

function createWindow(port) {
  logger.info('Creating main window...');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Mint',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#f1f5f3',
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5800');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'client-dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:|^tel:/i.test(url)) {
      shell.openExternal(url).catch((err) => {
        logger.error(`Failed to open external URL: ${url} (${err.message})`);
      });
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error(`Page load failed: ${errorDescription} (code: ${errorCode}) URL: ${validatedURL}`);
  });

  mainWindow.webContents.on('did-finish-load', () => logger.info('Page loaded successfully'));

  mainWindow.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) logger.debug(`[renderer] ${message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadClientApp() {
  if (!mainWindow) return;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5800');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'client-dist', 'index.html'));
  }
}

// ── 旧 userData 迁移（~/.mint 不存在时从 userData 拷贝）──

function migrateFromOldUserData() {
  // 此时 logger 尚未初始化，用 console.log
  try {
    const oldDir = app.getPath('userData');
    console.log(`[migrate] oldDir=${oldDir}, MINT_DIR=${MINT_DIR}`);

    if (oldDir === MINT_DIR) {
      console.log('[migrate] same path, skip');
      return;
    }
    if (!fs.existsSync(oldDir)) {
      console.log('[migrate] oldDir not found, skip');
      return;
    }
    if (
      fs.existsSync(path.join(MINT_DIR, 'data.db')) ||
      fs.existsSync(path.join(MINT_DIR, '.env'))
    ) {
      console.log('[migrate] .mint already has data, skip');
      return;
    }

    const items = fs.readdirSync(oldDir).filter((f) => f !== 'logs');
    console.log(`[migrate] items to migrate: ${items.length} — ${items.join(', ') || '(none)'}`);
    if (items.length === 0) return;

    // 只搬核心数据文件，跳过 Cache / Session Storage 等 Electron 运行时目录
    const coreFiles = items.filter((f) => f === 'data.db' || f === '.env');
    if (coreFiles.length === 0) {
      console.log('[migrate] no core files to migrate');
      return;
    }

    fs.mkdirSync(MINT_DIR, { recursive: true });

    for (const item of coreFiles) {
      const src = path.join(oldDir, item);
      const dst = path.join(MINT_DIR, item);
      fs.cpSync(src, dst, { recursive: true });
      console.log(`[migrate] copied: ${src} → ${dst}`);
    }

    console.log(`[migrate] done: ${oldDir} → ${MINT_DIR}`);
  } catch (err) {
    console.error(`[migrate] FAILED: ${err.message}`);
  }
}

// ── 应用生命周期 ──

app.whenReady().then(async () => {
  // 迁移旧数据（必须在 logger.init 之前，避免 .mint 被创建后干扰判断）
  migrateFromOldUserData();

  const logDir = getLogDir();
  const logFile = logger.init(logDir);
  setupGlobalErrorHandlers();
  logger.info(`Log file: ${logFile}`);

  // 设置环境变量（在导入服务之前）
  loadOrCreateEncryptionKey();
  process.env.AI_CHAT_DB_PATH = getDbPath();
  process.env.MINT_ELECTRON_BETTER_SQLITE3_PATH = path.join(
    __dirname,
    'node_modules',
    'better-sqlite3',
  );

  try {
    createWindow();

    // 加载服务模块并启动 server
    const [servicesLoaded] = await Promise.all([loadServiceModules(), startServer()]);

    if (servicesLoaded) {
      setupIpcHandlers();
    }

    loadClientApp();
  } catch (err) {
    logger.error(`Failed to start: ${err.message}`);
    const { dialog } = require('electron');
    dialog.showErrorBox('应用启动失败', `${err.message}\n\n详细日志：${logFile}`);
    logger.close();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logger.close();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
    loadClientApp();
  }
});
app.on('will-quit', () => {
  logger.close();
});

app.on('before-quit', (event) => {
  if (electronShutdownComplete) return;
  event.preventDefault();
  if (!electronShutdownPromise) {
    electronShutdownPromise = getServerBundle()
      .then((bundle) => bundle.shutdownServer('electron-quit'))
      .catch((err) => logger.warn(`Server shutdown failed: ${err.message}`))
      .finally(() => {
        electronShutdownComplete = true;
        app.quit();
      });
  }
});
