import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type EvalFeatureConfig = Record<
  string,
  { enabled?: boolean; options?: Record<string, unknown> }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFeatureConfig(parsed: unknown): EvalFeatureConfig {
  const source = isRecord(parsed) && isRecord(parsed.features) ? parsed.features : parsed;
  if (!isRecord(source)) throw new Error('Feature configuration must be a JSON object');

  const features: EvalFeatureConfig = {};
  for (const [id, value] of Object.entries(source)) {
    if (!isRecord(value)) throw new Error(`Feature ${id} must be an object`);
    const enabled = value.enabled;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new Error(`Feature ${id}.enabled must be boolean`);
    }
    const options = value.options;
    if (options !== undefined && !isRecord(options)) {
      throw new Error(`Feature ${id}.options must be an object`);
    }
    features[id] = {
      ...(enabled === undefined ? {} : { enabled }),
      ...(options === undefined ? {} : { options }),
    };
  }
  return features;
}

export function parseFeatureConfig(raw: string): EvalFeatureConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid feature configuration JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return normalizeFeatureConfig(parsed);
}

async function readFeatureConfigFile(filePath: string): Promise<EvalFeatureConfig> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') {
    return normalizeFeatureConfig(JSON.parse(await fs.readFile(filePath, 'utf8')));
  }
  if (extension !== '.js' && extension !== '.mjs') {
    throw new Error(`Feature configuration file must use .json, .js, or .mjs: ${filePath}`);
  }
  const module = await import(`${pathToFileURL(filePath).href}?cacheBust=${Date.now()}`);
  return normalizeFeatureConfig(module.default ?? module.features ?? module);
}

export async function resolveFeatureConfig(
  args: string[],
  evalDirectory: string,
): Promise<EvalFeatureConfig | undefined> {
  const raw = optionValue(args, '--features-json') || process.env.MINT_EVAL_FEATURES_JSON;
  if (raw) return parseFeatureConfig(raw);

  const configuredFile =
    optionValue(args, '--features-file') || process.env.MINT_EVAL_FEATURES_FILE;
  if (configuredFile) return readFeatureConfigFile(path.resolve(evalDirectory, configuredFile));

  for (const filePath of [
    path.join(evalDirectory, 'features.json'),
    path.join(evalDirectory, 'config.js'),
  ]) {
    try {
      await fs.access(filePath);
      return readFeatureConfigFile(filePath);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.lastIndexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}
