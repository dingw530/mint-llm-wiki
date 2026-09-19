import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(
  process.execPath,
  ['node_modules/.bin/tsx', 'scripts/lifecycle-process-child.mjs'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_CHAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
      AI_CHAT_DB_PATH: `/tmp/mint-lifecycle-signal-${process.pid}.db`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const port = await waitForPort(child, () => output);
const response = await fetch(`http://127.0.0.1:${port}/api/conversations`);
if (!response.ok) throw new Error(`HTTP smoke failed: ${response.status}`);
child.kill('SIGTERM');
const [exitCode, signal] = await once(child, 'exit');
if (exitCode !== 0 || signal) throw new Error(`child did not exit cleanly: ${output}`);
console.log(JSON.stringify({ port, exitCode, signal: signal || null, released: true }));

async function waitForPort(processHandle, readOutput) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const match = readOutput().match(/READY:(\d+)/);
    if (match) return Number(match[1]);
    if (processHandle.exitCode !== null) throw new Error(readOutput());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  processHandle.kill('SIGKILL');
  throw new Error(`timed out waiting for child: ${readOutput()}`);
}
