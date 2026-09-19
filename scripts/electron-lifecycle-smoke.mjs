import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

execFileSync('npm', ['run', 'build', '-w', 'mint-server'], { stdio: 'inherit' });
const result = spawnSync('node_modules/.bin/electron', ['scripts/electron-lifecycle-child.mjs'], {
  encoding: 'utf8',
  timeout: 120000,
  env: {
    ...process.env,
    AI_CHAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    AI_CHAT_DB_PATH: `/tmp/mint-electron-smoke-${process.pid}.db`,
    MINT_ELECTRON_BETTER_SQLITE3_PATH: join(process.cwd(), 'electron/node_modules/better-sqlite3'),
    ELECTRON_RUN_AS_NODE: '1',
  },
});
if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Electron smoke failed');
console.log(result.stdout.trim());
