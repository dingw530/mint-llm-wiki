const { isIP } = require('node:net');

const DEV_UPDATE_ENABLE_KEY = 'MINT_ENABLE_LOCAL_UPDATE_TESTS';
const DEV_UPDATE_URL_KEY = 'MINT_LOCAL_UPDATE_URL';

/** Resolve an explicitly enabled loopback-only development update source.
 * @param {Record<string, string|undefined>} env Process environment.
 * @returns {{enabled: false, reason?: string}|{enabled: true, url: string}}
 */
function resolveLocalDevUpdateSource(env) {
  if (env[DEV_UPDATE_ENABLE_KEY] !== '1') return { enabled: false };

  const rawUrl = env[DEV_UPDATE_URL_KEY];
  if (!rawUrl) return { enabled: false, reason: `${DEV_UPDATE_URL_KEY} is required` };

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { enabled: false, reason: `${DEV_UPDATE_URL_KEY} must be a valid URL` };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !isLoopbackHost(hostname)
  ) {
    return {
      enabled: false,
      reason: `${DEV_UPDATE_URL_KEY} must be a loopback HTTP URL without credentials, query, or fragment`,
    };
  }

  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return { enabled: true, url: url.toString() };
}

/** Check whether a hostname resolves syntactically to a loopback address.
 * @param {string} hostname Normalized URL hostname.
 * @returns {boolean} Whether the hostname is loopback-only.
 */
function isLoopbackHost(hostname) {
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (isIP(hostname) !== 4) return false;
  return Number(hostname.split('.')[0]) === 127;
}

/** Remove URLs and common credential forms from updater diagnostics.
 * @param {unknown} error Update failure value.
 * @returns {string} Safe, bounded diagnostic text.
 */
function sanitizeUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/(token|password|secret|authorization)(\s*[:=]\s*)\S+/gi, '$1$2[redacted]')
    .slice(0, 500);
}

/** Log an updater error without writing URLs or credentials.
 * @param {{warn: (message: string) => void}} logger Application logger.
 * @param {string} context Short failure context.
 * @param {unknown} error Update failure value.
 * @returns {void}
 */
function logUpdaterError(logger, context, error) {
  logger.warn(`${context}: ${sanitizeUpdateError(error)}`);
}

/** Check the configured update source and report a renderer-safe result.
 * @param {import('electron-updater').AppUpdater} autoUpdater Configured update service.
 * @param {{warn: (message: string) => void}} logger Application logger.
 * @returns {Promise<{status: 'current'|'available'|'error', availableVersion?: string, message?: string}>} Check result for the About view.
 */
async function checkForUpdates(autoUpdater, logger) {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.downloadPromise) {
      void result.downloadPromise.catch((error) =>
        logUpdaterError(logger, 'Update download failed', error),
      );
    }
    if (!result?.isUpdateAvailable) return { status: 'current' };
    return { status: 'available', availableVersion: result.updateInfo.version };
  } catch (error) {
    logUpdaterError(logger, 'Update check failed', error);
    return { status: 'error', message: sanitizeUpdateError(error) };
  }
}

/** Configure packaged or explicitly enabled development update checks and notify the renderer.
 * @param {{app: import('electron').App, autoUpdater: import('electron-updater').AppUpdater, env?: Record<string, string|undefined>, getMainWindow: () => import('electron').BrowserWindow|null, ipcMain?: typeof import('electron').ipcMain, notifyUpdateDownloaded?: (info: {version: string, mode: 'local-test'|'packaged'}) => void, logger: {info: (message: string) => void, warn: (message: string) => void, debug: (message: string) => void}, shutdownForInstall: () => Promise<void>}} dependencies Electron update services.
 * @returns {{enabled: boolean, devTestMode?: boolean}} Whether update checking is enabled.
 */
function configureAutoUpdater({
  app,
  autoUpdater,
  env = process.env,
  getMainWindow,
  ipcMain,
  notifyUpdateDownloaded,
  logger,
  shutdownForInstall,
}) {
  const localSource = app.isPackaged ? { enabled: false } : resolveLocalDevUpdateSource(env);
  const localDevTestMode = !app.isPackaged && localSource.enabled;
  let updateSourceEnabled = false;
  if (ipcMain) {
    ipcMain.handle('app:get-version', () => app.getVersion());
    ipcMain.handle('updater:check', async () => {
      if (!updateSourceEnabled) {
        return {
          status: 'disabled',
          message: localSource.reason || '开发模式默认不检查更新，请启用本地测试更新源后重试。',
        };
      }
      logger.info(
        `Manual update check started; source=${localDevTestMode ? 'local-test' : 'github'}`,
      );
      return checkForUpdates(autoUpdater, logger);
    });
  }
  if (!app.isPackaged && !localDevTestMode) {
    if (localSource.reason) logger.warn(`Local update test source disabled: ${localSource.reason}`);
    else logger.info('Updater disabled: development build has no local update test opt-in');
    return { enabled: false };
  }

  let promptOpen = false;
  let updateDownloaded = false;
  let installRequested = false;
  autoUpdater.forceDevUpdateConfig = localDevTestMode;
  if (localDevTestMode) {
    try {
      autoUpdater.disableDifferentialDownload = true;
      autoUpdater.setFeedURL({ provider: 'generic', url: localSource.url });
      logger.info('Local update test source enabled; feed=loopback');
    } catch (error) {
      logUpdaterError(logger, 'Local update test source setup failed', error);
      return { enabled: false };
    }
  }
  updateSourceEnabled = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.logger = {
    info: (message) => logger.info(sanitizeUpdateError(message)),
    warn: (message) => logUpdaterError(logger, 'Updater', message),
    error: (message) => logUpdaterError(logger, 'Updater', message),
    debug: (message) => logger.debug(sanitizeUpdateError(message)),
  };

  autoUpdater.on('error', (error) => logUpdaterError(logger, 'Updater error', error));
  autoUpdater.on('update-available', (info) => {
    logger.info(`Update available: version=${info.version}; downloading automatically`);
  });
  autoUpdater.on('update-not-available', (info) => {
    logger.info(`No update available: feed version=${info.version}`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (promptOpen) return;
    logger.info(
      `Update downloaded: version=${info.version}; mode=${localDevTestMode ? 'local-test' : 'packaged'}`,
    );
    promptOpen = true;
    updateDownloaded = !localDevTestMode;
    const updateInfo = {
      version: info.version,
      mode: localDevTestMode ? 'local-test' : 'packaged',
    };
    if (notifyUpdateDownloaded) notifyUpdateDownloaded(updateInfo);
    else {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) {
        window.webContents.send('updater:downloaded', updateInfo);
      } else logger.warn('Update prompt unavailable: main window is not ready');
    }
    promptOpen = false;
  });

  if (!localDevTestMode && ipcMain) {
    ipcMain.handle('updater:install-downloaded', async () => {
      if (!updateDownloaded || installRequested) return { success: false };
      installRequested = true;
      try {
        await shutdownForInstall();
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
      } catch (error) {
        installRequested = false;
        logUpdaterError(logger, 'Update installation failed', error);
        return { success: false };
      }
    });
  }

  if (!localDevTestMode) logger.info('GitHub updater enabled for packaged app');
  logger.info(`Update check started; source=${localDevTestMode ? 'local-test' : 'github'}`);
  void checkForUpdates(autoUpdater, logger);

  return { enabled: true, devTestMode: localDevTestMode };
}

module.exports = {
  configureAutoUpdater,
  resolveLocalDevUpdateSource,
  sanitizeUpdateError,
};
