const path = require('path');

/**
 * Build the main Electron window options for a platform.
 *
 * @param {string} platform Electron platform identifier.
 * @param {string} electronDir Absolute path to the Electron directory.
 * @returns {object} BrowserWindow options.
 */
function createWindowOptions(platform, electronDir) {
  const baseOptions = {
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Mint',
    icon: path.join(electronDir, 'icon.png'),
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(electronDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (platform !== 'darwin') {
    return { ...baseOptions, backgroundColor: '#f1f5f3' };
  }

  return {
    ...baseOptions,
    backgroundColor: '#00000000',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
  };
}

module.exports = { createWindowOptions };
