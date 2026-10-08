#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const runtime = process.argv[2];

if (!['node', 'electron'].includes(runtime)) {
  console.error('Usage: rebuild-native.cjs <node|electron>');
  process.exit(2);
}

function rebuildNodeModule() {
  const moduleDir = path.join(rootDir, 'node_modules', 'better-sqlite3');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['rebuild', '--prefix', moduleDir], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to rebuild better-sqlite3 for Node.js (exit ${result.status ?? 1})`);
  }
}

async function rebuildElectronModule() {
  const { rebuild } = require('@electron/rebuild');
  const electronDir = path.join(rootDir, 'apps', 'electron');
  const nodeModuleDir = path.join(rootDir, 'node_modules', 'better-sqlite3');
  const electronModuleDir = path.join(electronDir, 'node_modules', 'better-sqlite3');
  const electronVersion = require(
    path.join(rootDir, 'node_modules', 'electron', 'package.json'),
  ).version;

  if (!fs.existsSync(nodeModuleDir)) {
    throw new Error(`Node native module not found: ${nodeModuleDir}`);
  }

  fs.rmSync(electronModuleDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(electronModuleDir), { recursive: true });
  fs.cpSync(nodeModuleDir, electronModuleDir, { recursive: true });

  await rebuild({
    buildPath: electronDir,
    projectRootPath: electronDir,
    electronVersion,
    extraModules: ['better-sqlite3'],
    onlyModules: ['better-sqlite3'],
    force: true,
    mode: 'sequential',
  });

  // npm workspaces cause @electron/rebuild to also rebuild the hoisted copy.
  // Restore it for apps/server/Vitest while preserving the Electron copy above.
  rebuildNodeModule();

  console.log(`Electron native modules rebuilt for Electron ${electronVersion}`);
}

if (runtime === 'node') {
  try {
    rebuildNodeModule();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
} else {
  rebuildElectronModule().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
