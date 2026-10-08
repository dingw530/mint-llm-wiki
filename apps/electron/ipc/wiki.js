const fs = require('fs');
const path = require('path');

/**
 * 注册 Wiki 浏览、上传和作业状态 IPC handlers。
 *
 * 上传作业由 server bundle 中的共享 WikiIngestionJobService 执行，
 * Electron 层只负责 IPC 参数转换和桌面专属行为。
 *
 * @param {object} dependencies Electron 与服务依赖
 */
function registerWikiHandlers({ ipcMain, services, logger, shell }) {
  ipcMain.handle('wiki:openInObsidian', async () => {
    const settings = services.settSvc.get();
    const wikiPath = settings.wikiPath;
    if (!wikiPath) throw new Error('Wiki 路径未配置');
    if (!fs.existsSync(wikiPath) || !fs.statSync(wikiPath).isDirectory()) {
      throw new Error('Wiki 路径不存在或不是目录');
    }

    const absoluteWikiPath = path.resolve(wikiPath);
    const obsidianUri = `obsidian://open?path=${encodeURIComponent(absoluteWikiPath)}`;
    await shell.openExternal(obsidianUri);
    logger.info(`wiki:openInObsidian opened ${absoluteWikiPath}`);
    return { success: true };
  });

  ipcMain.handle('wiki:upload', async (_, { name, size, buffer, idempotencyKey }) => {
    if (!services.wikiIngestionJobService) throw new Error('Wiki ingestion service not loaded');
    const fileBuffer = Buffer.from(buffer);
    return services.wikiIngestionJobService.start({
      name,
      size: size || fileBuffer.length,
      buffer: fileBuffer,
      idempotencyKey,
    });
  });

  ipcMain.handle('wiki:getJobStatus', (_, jobId) => {
    const job = services.wikiIngestionJobService?.getStatus(jobId);
    if (!job) throw new Error('Job not found');
    return job;
  });
}

module.exports = {
  registerWikiHandlers,
};
