import { shutdownServer, startServer } from '../server/index.ts';

const port = await startServer(0);
console.log(`READY:${port}`);

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  await shutdownServer(signal);
}

process.once('SIGTERM', () => void stop('SIGTERM').finally(() => process.exit(0)));
process.once('SIGINT', () => void stop('SIGINT').finally(() => process.exit(0)));
