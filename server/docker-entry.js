/* global process, console */

// Docker 入口：设置静态文件路径并启动 HTTP 服务
process.env.AI_CHAT_CLIENT_DIST = '/app/client/dist';

const { shutdownServer, startDockerServer } = await import('./dist/index.js');
const port = parseInt(process.env.PORT || '3001', 10);

startDockerServer(port).catch((err) => {
  console.error('Failed to start server:', err);
  process.exitCode = 1;
});

let stopping = false;
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  shutdownServer(signal)
    .catch((err) => console.error('Failed to stop server:', err))
    .finally(() => process.exit());
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
