const { BrowserWindow } = require('electron');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SETTLE_MS = 1000;

/**
 * 创建 Electron 页面抓取 provider。
 */
function createElectronPageCaptureProvider(options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const settleMs = options.settleMs || DEFAULT_SETTLE_MS;

  return {
    async capture(url) {
      const window = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      const cleanup = () => {
        if (!window.isDestroyed()) {
          window.destroy();
        }
      };

      try {
        await loadUrl(window, url, timeoutMs);
        await delay(settleMs);

        const title = window.webContents.getTitle() || undefined;
        const finalUrl = window.webContents.getURL() || url;

        const html = await window.webContents.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""', true);
        if (typeof html === 'string' && html.trim()) {
          return {
            url,
            finalUrl,
            title,
            mode: 'html',
            content: html,
            source: 'electron',
          };
        }

        const text = await window.webContents.executeJavaScript(`
          (() => {
            const body = document.body;
            if (!body) return '';
            return (body.innerText || body.textContent || '').trim();
          })()
        `, true);

        if (typeof text === 'string' && text.trim()) {
          return {
            url,
            finalUrl,
            title,
            mode: 'text',
            content: text,
            source: 'electron',
          };
        }

        throw new Error('页面可访问但未提取到正文');
      } finally {
        cleanup();
      }
    },
  };
}

function loadUrl(window, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`页面加载超时: ${url}`));
    }, timeoutMs);

    const clear = () => {
      clearTimeout(timer);
    };

    window.webContents.once('did-finish-load', () => {
      if (settled) return;
      settled = true;
      clear();
      resolve();
    });

    window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (settled) return;
      settled = true;
      clear();
      reject(new Error(`页面加载失败: ${validatedURL || url} (${errorCode}) ${errorDescription}`));
    });

    window.loadURL(url).catch(err => {
      if (settled) return;
      settled = true;
      clear();
      reject(new Error(`页面加载失败: ${url} (${err.message})`));
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  createElectronPageCaptureProvider,
};
