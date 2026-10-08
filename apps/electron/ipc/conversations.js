/**
 * 注册 Electron 专属的会话与消息 IPC handlers。
 *
 * @param {object} dependencies Electron 与服务依赖
 */
function registerConversationHandlers({ ipcMain, services }) {
  ipcMain.handle('conversations:generateTitle', async (_, id) => {
    if (!services.convSvc || !services.settSvc) return { title: '' };

    const messages = services.messageRepository.findByConversationId(id);
    const firstUser = messages.find((message) => message.role === 'user');
    const firstAssistant = messages.find((message) => message.role === 'assistant');
    if (!firstUser || !firstAssistant) return { title: '' };

    const settings = services.settSvc.getAiSettings();
    const title = await services.aiProxy.generateTitle(
      settings,
      firstUser.content,
      firstAssistant.content,
    );
    if (title) services.convSvc.rename(id, title);
    return { title };
  });

  ipcMain.handle('messages:list', (_, convId) => {
    if (!services.msgSvc) throw new Error('Services not loaded');
    return { messages: services.msgSvc.getMessages(convId) };
  });
}

module.exports = {
  registerConversationHandlers,
};
