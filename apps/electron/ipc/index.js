const { registerChatHandlers } = require('./chat');
const { registerConversationHandlers } = require('./conversations');
const { registerWikiHandlers } = require('./wiki');
const { registerTrajectoryHandlers } = require('./trajectory');

/**
 * 注册依赖 Electron 上下文的 IPC handlers。
 *
 * @param {object} dependencies Electron 与服务依赖
 */
function registerElectronIpcHandlers(dependencies) {
  registerChatHandlers(dependencies);
  registerConversationHandlers(dependencies);
  registerWikiHandlers(dependencies);
  registerTrajectoryHandlers(dependencies);
}

module.exports = {
  registerElectronIpcHandlers,
};
