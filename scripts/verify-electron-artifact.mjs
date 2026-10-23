#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const rootDir = resolve(dirname(new URL(import.meta.url).pathname), '..');
const releaseDir = join(rootDir, 'apps', 'electron', 'release');

/** Run a build command from the repository root and fail on a non-zero exit. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 1}`);
}

/** Recursively locate the single macOS application emitted under one fresh output directory. */
async function findApp(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) return candidate;
    if (entry.isDirectory()) {
      const found = await findApp(candidate);
      if (found) return found;
    }
  }
  return undefined;
}

/** Require one expected packaged file or directory. */
function assertFile(file, label) {
  if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
}

/** Return normalized archive paths without the asar CLI's leading slash. */
function listAsar(asarPath) {
  return execFileSync(join(rootDir, 'node_modules', '.bin', 'asar'), ['list', asarPath], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\/+/, ''));
}

/** Build and inspect fresh unsigned macOS installer artifacts. */
async function main() {
  if (process.platform !== 'darwin')
    throw new Error('Electron artifact verification currently requires macOS.');

  const buildId = `verify-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outputDir = join(releaseDir, buildId);
  const rootPackage = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  await mkdir(outputDir, { recursive: true });
  run('node', [
    'scripts/with-node-version.cjs',
    'npm',
    'run',
    'electron:build:mac',
    '--',
    `--config.directories.output=${outputDir}`,
  ]);

  const appPath = await findApp(outputDir);
  if (!appPath) throw new Error(`No .app artifact was created in ${outputDir}`);
  const updateMetadataPath = join(outputDir, 'latest-mac.yml');
  const zipPath = join(outputDir, `Mint-${rootPackage.version}-${process.arch}-mac.zip`);
  const dmgPath = join(outputDir, `Mint-${rootPackage.version}-${process.arch}.dmg`);
  assertFile(updateMetadataPath, 'macOS updater metadata');
  assertFile(zipPath, 'macOS updater ZIP');
  assertFile(dmgPath, 'macOS DMG installer');
  const updateMetadata = await readFile(updateMetadataPath, 'utf8');
  for (const expected of [
    `version: ${rootPackage.version}`,
    `url: Mint-${rootPackage.version}-${process.arch}-mac.zip`,
    `url: Mint-${rootPackage.version}-${process.arch}.dmg`,
  ]) {
    if (!updateMetadata.includes(expected)) {
      throw new Error(`Unexpected macOS updater metadata; missing ${expected}`);
    }
  }

  const resourcesDir = join(appPath, 'Contents', 'Resources');
  const asarPath = join(resourcesDir, 'app.asar');
  const unpackedDir = join(resourcesDir, 'app.asar.unpacked');
  assertFile(asarPath, 'app.asar');
  assertFile(unpackedDir, 'app.asar.unpacked');
  assertFile(join(resourcesDir, 'app-update.yml'), 'electron-updater configuration');
  const updateConfig = await readFile(join(resourcesDir, 'app-update.yml'), 'utf8');
  for (const expected of ['provider: github', 'owner: dingw530', 'repo: mint-ai-chat']) {
    if (!updateConfig.includes(expected)) {
      throw new Error(`Unexpected electron-updater configuration; missing ${expected}`);
    }
  }

  const archiveEntries = listAsar(asarPath);
  for (const expected of [
    'services/auto-updater.js',
    'server-dist/index.js',
    'client-dist/index.html',
    'node_modules/better-sqlite3/package.json',
    'node_modules/electron-updater/package.json',
    'node_modules/pdfjs-dist/package.json',
    'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  ]) {
    if (!archiveEntries.includes(expected))
      throw new Error(`Missing packaged archive entry: ${expected}`);
  }

  const sqliteVec = join(
    unpackedDir,
    'node_modules',
    `sqlite-vec-darwin-${process.arch}`,
    'vec0.dylib',
  );
  assertFile(sqliteVec, 'unpacked sqlite-vec dynamic library');
  const evidence = {
    buildId,
    version: rootPackage.version,
    appPath,
    asarPath,
    updateMetadataPath,
    zipPath,
    dmgPath,
    unpackedDir,
    sqliteVec,
    archiveVerified: true,
  };
  const evidenceFile = join(outputDir, 'verification-evidence.json');
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence, evidenceFile }, null, 2));
}

main().catch((error) => {
  console.error(`[verify-electron-artifact] ${error.message}`);
  process.exitCode = 1;
});
