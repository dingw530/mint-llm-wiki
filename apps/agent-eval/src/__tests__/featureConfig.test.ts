import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseFeatureConfig, resolveFeatureConfig } from '../featureConfig.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('feature configuration', () => {
  it('parses a feature wrapper and preserves unknown features', () => {
    expect(
      parseFeatureConfig(
        JSON.stringify({ features: { future: { enabled: true, options: { mode: 'strict' } } } }),
      ),
    ).toEqual({ future: { enabled: true, options: { mode: 'strict' } } });
  });

  it('loads JSON configuration from an explicit file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-eval-features-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'features.json');
    await writeFile(filePath, JSON.stringify({ jev: { enabled: false } }));

    await expect(resolveFeatureConfig(['--features-file', filePath], directory)).resolves.toEqual({
      jev: { enabled: false },
    });
  });

  it('loads an ESM config.js default export from an explicit file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-eval-features-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    const filePath = path.join(directory, 'config.js');
    await writeFile(
      filePath,
      'export default { features: { jev: { options: { routingEnabled: true } } } };',
    );

    await expect(resolveFeatureConfig(['--features-file', filePath], directory)).resolves.toEqual({
      jev: { options: { routingEnabled: true } },
    });
  });
});
