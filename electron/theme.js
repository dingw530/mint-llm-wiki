/**
 * Keep Electron native surfaces independent of the operating system appearance.
 * @param {import('electron').NativeTheme} nativeTheme Electron native theme controller.
 * @returns {void}
 */
function lockLightTheme(nativeTheme) {
  nativeTheme.themeSource = 'light';
}

module.exports = { lockLightTheme };
