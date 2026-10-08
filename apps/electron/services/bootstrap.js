const { createElectronPageCaptureProvider } = require('./wikiPageCapture');

/**
 * 将 Electron 专属能力注入 server bundle。
 */
function registerElectronServices(bundle) {
  if (!bundle?.pageCaptureService?.setPageCaptureProvider) return;

  bundle.pageCaptureService.setPageCaptureProvider(
    createElectronPageCaptureProvider({
      timeoutMs: 15000,
      settleMs: 1000,
    }),
  );
}

module.exports = {
  registerElectronServices,
};
