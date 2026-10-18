#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Read and parse one package manifest.
 * @param {string} root Repository root.
 * @param {string} relativePath Manifest path relative to the root.
 * @returns {Promise<{version: string, [key: string]: unknown}>}
 */
async function readManifest(root, relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
}

/** Validate package versions and an optional release tag against the root version.
 * @param {string} root Repository root.
 * @param {string|undefined} tag Optional Git release tag.
 * @returns {Promise<{expectedVersion: string, errors: string[], valid: boolean}>}
 */
export async function checkReleaseVersion(root = rootDir, tag) {
  const rootManifest = await readManifest(root, 'package.json');
  const expectedVersion = rootManifest.version;
  const errors = [];
  const workspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : rootManifest.workspaces?.packages;

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
    errors.push(`Root package version is not SemVer: ${expectedVersion}`);
  }
  if (!Array.isArray(workspaces)) {
    errors.push('Root package manifest must declare workspace paths');
  }

  for (const workspace of workspaces || []) {
    if (workspace.includes('*')) {
      errors.push(`Workspace glob is not supported by the release version check: ${workspace}`);
      continue;
    }
    const manifestPath = `${workspace}/package.json`;
    const manifest = await readManifest(root, manifestPath);
    if (manifest.version !== expectedVersion) {
      errors.push(`${manifestPath} has version ${manifest.version}; expected ${expectedVersion}`);
    }
  }

  if (tag) {
    const tagVersion = tag.replace(/^v/, '');
    if (tagVersion !== expectedVersion) {
      errors.push(`Release tag ${tag} does not match root version ${expectedVersion}`);
    }
  }

  return { expectedVersion, errors, valid: errors.length === 0 };
}

/** Validate this checkout using an optional --tag argument.
 * @returns {Promise<void>}
 */
async function main() {
  const tagIndex = process.argv.indexOf('--tag');
  const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined;
  if (tagIndex >= 0 && !tag) throw new Error('--tag requires a value');

  const result = await checkReleaseVersion(rootDir, tag);
  if (!result.valid) {
    for (const error of result.errors) console.error(`✗ ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ Mint release version ${result.expectedVersion} is consistent`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
