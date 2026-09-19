/**
 * 注册流式对话 IPC handler。
 *
 * @param {object} dependencies Electron 与服务依赖
 */
/* global module */

function registerChatHandlers({ ipcMain, services, logger }) {
  ipcMain.handle('chat:send', async (event, convId, content, agent, regenerate, slashCommand) => {
    if (!services.msgSvc) {
      event.sender.send('chat:error', convId, 'Services not loaded');
      return;
    }

    const sink = new services.sinkMod.IpcSink(event, convId);
    try {
      await services.msgSvc.sendMessage(
        convId,
        content,
        sink,
        agent,
        regenerate,
        undefined,
        slashCommand,
      );
    } catch (err) {
      logger.error(`chat:send error: ${err.message}`);
      if (!sink.writableEnded) event.sender.send('chat:error', convId, err.message);
    }
  });

  ipcMain.handle('chat:stream-recovery-action', async (event, convId, actionId) => {
    if (!services.msgSvc) {
      event.sender.send('chat:error', convId, 'Services not loaded');
      return;
    }

    const sink = new services.sinkMod.IpcSink(event, convId);
    try {
      await services.msgSvc.streamRecoveryAction(convId, actionId, sink);
    } catch (err) {
      logger.error(`chat:stream-recovery-action error: ${err.message}`);
      if (!sink.writableEnded) event.sender.send('chat:error', convId, err.message);
    }
  });

  ipcMain.handle('chat:a2ui:subscribe', (event, conversationId) => {
    const service = services.wikiIngestionJobService;
    const a2ui = services.ingestionA2ui;
    if (!service) throw new Error('Wiki ingestion service not loaded');
    const send = (payload) => event.sender.send('chat:a2ui', JSON.stringify(payload));
    const sentSurfaces = new Set();
    const jobs = service
      .list({ limit: 100 })
      .filter((job) => job.sourceType === 'chat' && job.conversationId === conversationId);
    for (const job of jobs) {
      send(a2ui.createSurface(job));
      send(a2ui.updateComponents(job));
      send(a2ui.updateDataModel(job));
      sentSurfaces.add(job.id);
    }
    const unsubscribe = service.subscribe((job) => {
      if (job.sourceType === 'chat' && job.conversationId === conversationId) {
        if (!sentSurfaces.has(job.id)) {
          send(a2ui.createSurface(job));
          send(a2ui.updateComponents(job));
          sentSurfaces.add(job.id);
        }
        send(a2ui.updateDataModel(job));
      }
    });
    event.sender.once('destroyed', unsubscribe);
    return { subscribed: true };
  });
}

module.exports = {
  registerChatHandlers,
};
