import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  configureAutoUpdater,
  resolveLocalDevUpdateSource,
} = require('../apps/electron/services/auto-updater.js');
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('dev updater config provides a local feed and cache directory', async () => {
  const config = await readFile(resolve(rootDir, 'apps/electron/dev-app-update.yml'), 'utf8');
  assert.match(config, /url:\s*http:\/\/127\.0\.0\.1:4173\//);
  assert.match(config, /updaterCacheDirName:\s*mint-electron-updater-dev/);
});

function createHarness({
  packaged = true,
  response = 1,
  env = {},
  checkForUpdates = async () => ({}),
} = {}) {
  const state = { shutdownCalls: 0, dialogCalls: 0, checks: 0 };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => {
        state.updateEvent = { channel, payload };
      },
    },
  };
  const ipcMain = {
    handle: (channel, handler) => {
      state.ipcHandler = { channel, handler };
    },
  };
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = async () => {
    state.checks += 1;
    return checkForUpdates();
  };
  autoUpdater.quitAndInstall = (...args) => autoUpdater.installCalls.push(args);
  autoUpdater.setFeedURL = (options) => {
    state.feedOptions = options;
  };
  autoUpdater.installCalls = [];
  const logs = [];
  const logger = {
    info: (message) => logs.push(message),
    warn: (message) => logs.push(message),
    debug: (message) => logs.push(message),
  };
  const dialog = {
    async showMessageBox(...args) {
      state.dialogCalls += 1;
      state.dialogArgs = args;
      return { response };
    },
  };
  const configure = () =>
    configureAutoUpdater({
      app: { isPackaged: packaged },
      autoUpdater,
      dialog,
      env,
      getMainWindow: () => mainWindow,
      ipcMain,
      logger,
      shutdownForInstall: async () => {
        state.shutdownCalls += 1;
      },
    });
  return { autoUpdater, configure, logs, state };
}

test('skips update checks in development mode', async () => {
  const harness = createHarness({ packaged: false });
  assert.deepEqual(harness.configure(), { enabled: false });
  await Promise.resolve();
  assert.equal(harness.autoUpdater.listenerCount('update-downloaded'), 0);
  assert.equal(harness.autoUpdater.autoDownload, undefined);
  assert.equal(harness.state.checks, 0);
  assert.ok(
    harness.logs.includes('Updater disabled: development build has no local update test opt-in'),
  );
});

test('accepts explicit loopback development update URLs only', () => {
  const accepted = resolveLocalDevUpdateSource({
    MINT_ENABLE_LOCAL_UPDATE_TESTS: '1',
    MINT_LOCAL_UPDATE_URL: 'http://127.0.0.1:4173/updates',
  });
  assert.deepEqual(accepted, { enabled: true, url: 'http://127.0.0.1:4173/updates/' });
  assert.deepEqual(
    resolveLocalDevUpdateSource({
      MINT_ENABLE_LOCAL_UPDATE_TESTS: '1',
      MINT_LOCAL_UPDATE_URL: 'http://[::1]:4173/',
    }),
    { enabled: true, url: 'http://[::1]:4173/' },
  );

  for (const url of [
    'https://127.0.0.1:4173/',
    'http://192.168.1.4:4173/',
    'http://user:pass@127.0.0.1:4173/',
    'http://localhost:4173/?token=secret',
  ]) {
    assert.equal(
      resolveLocalDevUpdateSource({
        MINT_ENABLE_LOCAL_UPDATE_TESTS: '1',
        MINT_LOCAL_UPDATE_URL: url,
      }).enabled,
      false,
    );
  }
});

test('explicit development mode checks and downloads from the local feed only', async () => {
  const harness = createHarness({
    packaged: false,
    env: {
      MINT_ENABLE_LOCAL_UPDATE_TESTS: '1',
      MINT_LOCAL_UPDATE_URL: 'http://localhost:4173/updates/',
    },
  });
  assert.deepEqual(harness.configure(), { enabled: true, devTestMode: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.state.checks, 1);
  assert.deepEqual(harness.state.feedOptions, {
    provider: 'generic',
    url: 'http://localhost:4173/updates/',
  });
  assert.equal(harness.autoUpdater.forceDevUpdateConfig, true);
  assert.equal(harness.autoUpdater.autoDownload, true);
  assert.equal(harness.autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(harness.autoUpdater.disableDifferentialDownload, true);
  assert.ok(harness.logs.includes('Local update test source enabled; feed=loopback'));
  assert.ok(harness.logs.includes('Update check started; source=local-test'));
  assert.equal(
    harness.logs.some((message) => message.includes('localhost:4173')),
    false,
  );
});

test('development download sends the Mint prompt but never installs or shuts down the server', async () => {
  const harness = createHarness({
    packaged: false,
    response: 0,
    env: {
      MINT_ENABLE_LOCAL_UPDATE_TESTS: '1',
      MINT_LOCAL_UPDATE_URL: 'http://127.0.0.1:4173/',
    },
  });
  harness.configure();
  harness.autoUpdater.emit('update-downloaded', { version: '0.1.1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.state.updateEvent, {
    channel: 'updater:downloaded',
    payload: { version: '0.1.1', mode: 'local-test' },
  });
  assert.equal(harness.state.dialogCalls, 0);
  assert.equal(harness.state.shutdownCalls, 0);
  assert.deepEqual(harness.autoUpdater.installCalls, []);
  assert.ok(harness.logs.includes('Update downloaded: version=0.1.1; mode=local-test'));
});

test('packaged apps ignore local development update environment variables', async () => {
  const harness = createHarness({
    packaged: true,
    env: {
      MINT_ENABLE_LOCAL_UPDATE_TESTS: '1',
      MINT_LOCAL_UPDATE_URL: 'http://127.0.0.1:4173/',
    },
  });
  assert.deepEqual(harness.configure(), { enabled: true, devTestMode: false });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.state.feedOptions, undefined);
  assert.equal(harness.autoUpdater.forceDevUpdateConfig, false);
  assert.equal(harness.autoUpdater.autoInstallOnAppQuit, false);
  assert.ok(harness.logs.includes('GitHub updater enabled for packaged app'));
  assert.ok(harness.logs.includes('Update check started; source=github'));
});

test('checks and downloads updates for packaged builds', async () => {
  let checks = 0;
  const harness = createHarness({
    checkForUpdates: async () => {
      checks += 1;
    },
  });
  assert.deepEqual(harness.configure(), { enabled: true, devTestMode: false });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(checks, 1);
  assert.equal(harness.autoUpdater.autoDownload, true);
  assert.equal(harness.autoUpdater.autoInstallOnAppQuit, false);
});

test('logs whether a newer version is available', () => {
  const harness = createHarness();
  harness.configure();
  harness.autoUpdater.emit('update-available', { version: '0.2.0' });
  harness.autoUpdater.emit('update-not-available', { version: '0.1.0' });
  assert.ok(harness.logs.includes('Update available: version=0.2.0; downloading automatically'));
  assert.ok(harness.logs.includes('No update available: feed version=0.1.0'));
});

test('logs a rejected automatic download without an unhandled rejection', async () => {
  const harness = createHarness({
    checkForUpdates: async () => ({
      downloadPromise: Promise.reject(new Error('local package download failed')),
    }),
  });
  harness.configure();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(harness.logs.includes('Update download failed: local package download failed'));
});

test('explicit install waits for server shutdown before quitting to install', async () => {
  const harness = createHarness();
  harness.configure();
  harness.autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.state.updateEvent, {
    channel: 'updater:downloaded',
    payload: { version: '0.2.0', mode: 'packaged' },
  });
  assert.equal(harness.state.ipcHandler.channel, 'updater:install-downloaded');
  await harness.state.ipcHandler.handler();
  assert.equal(harness.state.shutdownCalls, 1);
  assert.deepEqual(harness.autoUpdater.installCalls, [[false, true]]);
});

test('downloaded updates are not installed automatically on app quit', async () => {
  const harness = createHarness();
  harness.configure();
  harness.autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(harness.state.shutdownCalls, 0);
  assert.deepEqual(harness.autoUpdater.installCalls, []);
});

test('check failures are logged without URLs or credentials', async () => {
  const harness = createHarness({
    checkForUpdates: async () => {
      throw new Error('failed https://user:pass@example.test/path?token=ghp_private-token');
    },
  });
  harness.configure();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    harness.logs.some((message) => message.includes('example.test')),
    false,
  );
  assert.equal(
    harness.logs.some((message) => message.includes('private-token')),
    false,
  );
  assert.equal(
    harness.logs.some((message) => message.includes('[url]')),
    true,
  );
});
