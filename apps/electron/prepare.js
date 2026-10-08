/**
 * Electron 构建准备脚本
 *
 * 生产包使用 apps/server/electron-dist 下的单文件 ESM bundle，普通 JS 依赖全部内联。
 * 此脚本仅需拷贝：
 *   1. 原生模块（better-sqlite3、pdfjs-dist）→ apps/electron/node_modules/
 *   2. server bundle → apps/electron/server-dist/
 *   3. client 构建产物 → apps/electron/client-dist/
 */
const { cp, rm, writeFile, access } = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '../..');
const electronDir = __dirname;

/**
 * Returns the sqlite-vec package that contains the current platform's loadable extension.
 * @returns {string} Package name for the current platform and CPU architecture.
 */
function getSqliteVecPlatformPackageName() {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  return `sqlite-vec-${os}-${process.arch}`;
}

// 仅原生/WASM 模块需要从 node_modules 拷贝
const NATIVE_MODULES = [
  'better-sqlite3',
  'pdfjs-dist',
  'sqlite-vec',
  getSqliteVecPlatformPackageName(),
];

function buildServerBundle() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'build:bundle', '-w', 'mint-server'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

function rebuildElectronNativeModule() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'electron:rebuild'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

async function copyNativeModules() {
  const rootNm = path.join(rootDir, 'node_modules');
  const electronNm = path.join(electronDir, 'node_modules');

  // 清理旧 node_modules，确保不残留已移除的依赖
  await rm(electronNm, { recursive: true, force: true });
  await access(rootNm); // ensure root node_modules exists

  let copied = 0;
  for (const mod of NATIVE_MODULES) {
    const src = path.join(rootNm, mod);
    const dest = path.join(electronNm, mod);
    try {
      await access(src);
      await cp(src, dest, { recursive: true });
      copied++;
    } catch {
      console.warn(`⚠ Skipping ${mod}: not found in node_modules`);
    }
  }
  console.log(`✓ Copied ${copied}/${NATIVE_MODULES.length} native modules`);
}

async function prepare() {
  buildServerBundle();

  // 拷贝原生模块（先清理旧 node_modules）
  await copyNativeModules();
  rebuildElectronNativeModule();

  // 清理旧产物
  await rm(path.join(electronDir, 'server-dist'), { recursive: true, force: true });
  await rm(path.join(electronDir, 'client-dist'), { recursive: true, force: true });

  // 复制 server bundle
  await cp(
    path.join(rootDir, 'apps', 'server', 'electron-dist'),
    path.join(electronDir, 'server-dist'),
    { recursive: true },
  );

  // server 是 ESM，必须写入 package.json 声明模块类型
  await writeFile(
    path.join(electronDir, 'server-dist', 'package.json'),
    JSON.stringify({ type: 'module' }) + '\n',
    'utf-8',
  );

  // 复制构建后的 client
  await cp(path.join(rootDir, 'apps', 'client', 'dist'), path.join(electronDir, 'client-dist'), {
    recursive: true,
  });

  console.log('✓ Electron build prepared (server-dist, client-dist)');
}

prepare().catch((err) => {
  console.error('Prepare failed:', err);
  process.exit(1);
});
