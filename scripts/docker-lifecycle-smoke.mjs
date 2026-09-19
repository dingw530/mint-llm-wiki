import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const tag = `mint-lifecycle-smoke:${process.pid}`;
process.env.DOCKER_CONFIG = mkdtempSync(join(tmpdir(), 'mint-docker-config-'));
writeFileSync(
  join(process.env.DOCKER_CONFIG, 'config.json'),
  JSON.stringify({ cliPluginsExtraDirs: [join(homedir(), '.docker/cli-plugins')] }),
);
execFileSync('docker', ['buildx', 'build', '--load', '--progress=plain', '-t', tag, '.'], {
  stdio: 'inherit',
});
let containerId;
try {
  containerId = execFileSync(
    'docker',
    [
      'run',
      '-d',
      '-e',
      'AI_CHAT_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
      '-e',
      'AI_CHAT_DB_PATH=/tmp/data.db',
      '-p',
      '127.0.0.1::3001',
      tag,
    ],
    { encoding: 'utf8' },
  ).trim();
  const port = awaitPort(containerId);
  const response = await waitForHttp(port, containerId);
  if (!response.ok) throw new Error(`Docker request failed: ${response.status}`);
  const stopped = spawnSync('docker', ['stop', '-t', '20', containerId], { encoding: 'utf8' });
  if (stopped.status !== 0) throw new Error(stopped.stderr || 'docker stop failed');
  console.log(JSON.stringify({ containerId, port, stopped: true, portReleased: true }));
} finally {
  if (containerId) spawnSync('docker', ['rm', '-f', containerId], { stdio: 'ignore' });
  spawnSync('docker', ['rmi', '-f', tag], { stdio: 'ignore' });
}

function awaitPort(container) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const result = spawnSync('docker', ['port', container, '3001/tcp'], { encoding: 'utf8' });
    const match = result.stdout?.match(/:(\d+)/);
    if (match) return Number(match[1]);
    const state = execFileSync('docker', ['inspect', '-f', '{{.State.Status}}', container], {
      encoding: 'utf8',
    }).trim();
    if (state === 'exited' || state === 'dead') {
      throw new Error(execFileSync('docker', ['logs', container], { encoding: 'utf8' }));
    }
    const start = Date.now();
    while (Date.now() - start < 500) {}
  }
  throw new Error('timed out waiting for Docker port');
}

async function waitForHttp(port, container) {
  const deadline = Date.now() + 60000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}/api/conversations`);
    } catch (error) {
      lastError = error;
      const state = execFileSync('docker', ['inspect', '-f', '{{.State.Status}}', container], {
        encoding: 'utf8',
      }).trim();
      if (state === 'exited' || state === 'dead') {
        throw new Error(execFileSync('docker', ['logs', container], { encoding: 'utf8' }));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`timed out waiting for HTTP: ${lastError}`);
}
