import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 验证 Session 与 Agent UI 包可独立加载，且 Agent UI 不依赖 Mint 宿主。 */
function runPackageSmoke() {
  buildWorkspace('@mint/session');
  buildWorkspace('@mint/agent-ui');
  const packageRoot = path.join(root, 'packages/agent-ui');
  const packageJson = readJson(path.join(packageRoot, 'package.json'));
  const workspaces = readJson(path.join(root, 'package.json')).workspaces;
  const clientPackage = readJson(path.join(root, 'apps/client/package.json'));
  assert(workspaces.includes('packages/session'), 'root workspace omits @mint/session');
  assert(workspaces.includes('packages/agent-ui'), 'root workspace omits @mint/agent-ui');
  assert(
    clientPackage.dependencies['@mint/agent-ui'] === '*',
    'Mint client does not depend on @mint/agent-ui',
  );
  assert(packageJson.peerDependencies.react, '@mint/agent-ui must declare React as a peer');
  assert(
    packageJson.peerDependencies['@mint/session'],
    '@mint/agent-ui must declare session types as a peer',
  );
  assert(packageJson.exports['./styles.css'], '@mint/agent-ui must expose an explicit stylesheet');
  assert(!packageJson.dependencies?.react, '@mint/agent-ui must not bundle a second React');

  const source = listFiles(path.join(packageRoot, 'src'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  for (const forbidden of [
    '@/services',
    'react-router',
    'apps/server',
    'apps/client',
    'window.electronAPI',
  ]) {
    assert(!source.includes(forbidden), `Agent UI source imports host dependency: ${forbidden}`);
  }
  const stylesheet = readFileSync(path.join(packageRoot, 'src/styles.css'), 'utf8');
  assert(
    !/--agent-trace-/.test(stylesheet),
    'Agent UI tokens must use the --mint-agent-ui-* namespace',
  );
  assert(/--mint-agent-ui-/.test(stylesheet), 'Agent UI stylesheet declares no package tokens');
  assert(
    statSync(path.join(packageRoot, 'dist/index.js')).isFile(),
    'Agent UI build output is missing',
  );
  assert(
    statSync(path.join(root, 'packages/session/dist/index.js')).isFile(),
    'Session build output is missing',
  );

  verifyPackedFiles();
  runHostSmoke();
  verifyClientAndElectronRegistration();
  process.stdout.write(
    'SESSION_PACKAGES_OK portable_ui=true no_host_imports=true token_isolation=true web_electron_load=true\n',
  );
}

/** 在验证包边界前构建 workspace 的稳定 ESM 产物。 */
function buildWorkspace(workspace) {
  const cache = mkdtempSync(path.join(os.tmpdir(), 'mint-session-build-cache-'));
  try {
    const result = spawnSync('npm', ['run', 'build', `--workspace=${workspace}`], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cache },
    });
    if (result.status !== 0)
      throw new Error(result.stderr || result.stdout || `${workspace} build failed`);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

/** 核对 npm 包白名单包含编译入口、类型、样式和 README。 */
function verifyPackedFiles() {
  const cache = mkdtempSync(path.join(os.tmpdir(), 'mint-session-package-cache-'));
  try {
    const result = spawnSync('npm', ['pack', '--dry-run', '--workspace=@mint/agent-ui'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cache },
    });
    if (result.status !== 0) throw new Error(result.stderr || 'npm pack dry-run failed');
    const output = `${result.stdout}${result.stderr}`;
    for (const required of ['README.md', 'dist/index.js', 'dist/index.d.ts', 'src/styles.css']) {
      assert(output.includes(required), `packed Agent UI output is missing ${required}`);
    }
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

/** 在 Node 独立进程中运行最小 React 宿主 smoke。 */
function runHostSmoke() {
  const result = spawnSync(process.execPath, ['packages/agent-ui/scripts/host-smoke.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.includes('AGENT_UI_HOST_SMOKE_OK')) {
    throw new Error(result.stderr || result.stdout || 'Agent UI React host smoke failed');
  }
}

/** 确认 Web 与 Electron 使用的构建顺序和 preload API 均已注册。 */
function verifyClientAndElectronRegistration() {
  const rootPackage = readJson(path.join(root, 'package.json'));
  const preload = readFileSync(path.join(root, 'apps/electron/preload.js'), 'utf8');
  const ipc = readFileSync(path.join(root, 'apps/electron/ipc/trajectory.js'), 'utf8');
  const manifest = readJson(path.join(root, 'apps/electron/endpoints-manifest.json'));
  assert(
    rootPackage.scripts.build.includes('@mint/agent-ui'),
    'root build does not build the UI package',
  );
  assert(
    preload.includes('subscribeTrajectory'),
    'Electron preload has no trajectory subscription',
  );
  assert(
    preload.includes('unsubscribeTrajectory'),
    'Electron preload has no trajectory cancellation',
  );
  assert(
    ipc.includes('conversations:streamTrajectory'),
    'Electron IPC does not use the shared stream service',
  );
  assert(
    manifest.some((item) => item.id === 'conversations:getTrajectory'),
    'Electron manifest omits trajectory snapshots',
  );
  assert(
    manifest.some((item) => item.id === 'conversations:getTrajectoryEvent'),
    'Electron manifest omits trajectory detail',
  );
}

/** 递归列出一个源码目录下的文件。 */
function listFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    return statSync(file).isDirectory() ? listFiles(file) : [file];
  });
}

/** 读取 JSON 配置对象。 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 用可读错误消息终止不满足的 smoke 条件。 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

runPackageSmoke();
