import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = resolve(rootDir, '.github/workflows/electron-release.yml');
const electronPackagePath = resolve(rootDir, 'apps/electron/package.json');

test('release workflow validates tags and builds a Draft GitHub Release', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const electronPackage = JSON.parse(await readFile(electronPackagePath, 'utf8'));
  assert.match(workflow, /tags:\s*\n\s*-\s*'v\*\.\*\.\*'/);
  assert.match(workflow, /npm run check:release-version -- --tag/);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.equal(electronPackage.build.publish[0].provider, 'github');
  assert.equal(electronPackage.build.publish[0].releaseType, 'draft');
});

test('release workflow requires signing and notarization secrets before packaging', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const requiredSecrets = [
    'MACOS_CERTIFICATE',
    'MACOS_CERTIFICATE_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ];
  for (const secret of requiredSecrets) assert.ok(workflow.includes(`secrets.${secret}`));
  assert.match(workflow, /Required release secret is missing/);
  assert.match(workflow, /exit 1/);
});

test('macOS updater builds both installer and auto-update package formats', async () => {
  const electronPackage = JSON.parse(await readFile(electronPackagePath, 'utf8'));
  assert.deepEqual(electronPackage.build.mac.target, ['dmg', 'zip']);
  assert.equal(electronPackage.dependencies['electron-updater'], '^6.8.9');
});
