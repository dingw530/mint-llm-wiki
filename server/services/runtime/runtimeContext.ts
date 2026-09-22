import type { JevSettings } from '../../types.js';
import { DISABLED_JEV_SETTINGS } from '../jev/config.js';

/** 一个可由评测或运行时注入的能力配置。 */
export interface FeatureConfig {
  enabled: boolean;
  options: Readonly<Record<string, unknown>>;
}

/** 能力配置输入；未知能力会被保留，便于后续扩展。 */
export type FeatureConfigInput = Record<
  string,
  { enabled?: boolean; options?: Record<string, unknown> }
>;

/** 一次执行共享的运行时能力上下文。 */
export interface RuntimeContext {
  readonly features: ReadonlyMap<string, FeatureConfig>;
  getFeature(id: string): FeatureConfig | undefined;
  getJevSettings(): JevSettings;
}

interface RuntimeContextInput {
  features?: FeatureConfigInput;
  fallbackJev?: JevSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(options: Record<string, unknown>, key: string, fallback: string): string {
  const value = options[key];
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(options: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = options[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(options: Record<string, unknown>, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readJevSettings(feature: FeatureConfig | undefined, fallback: JevSettings): JevSettings {
  if (!feature) return fallback;
  if (!feature.enabled) return { ...DISABLED_JEV_SETTINGS };
  const options = feature.options;
  return {
    apiUrl: readString(options, 'apiUrl', fallback.apiUrl),
    apiKey: readString(options, 'apiKey', fallback.apiKey),
    model: readString(options, 'model', fallback.model),
    timeoutMs: readNumber(options, 'timeoutMs', fallback.timeoutMs),
    routingEnabled: readBoolean(options, 'routingEnabled', fallback.routingEnabled),
    routingMinConfidence: readNumber(
      options,
      'routingMinConfidence',
      fallback.routingMinConfidence,
    ),
    routingBypassOnKeyword: readBoolean(
      options,
      'routingBypassOnKeyword',
      fallback.routingBypassOnKeyword,
    ),
    memoryEnabled: readBoolean(options, 'memoryEnabled', fallback.memoryEnabled),
    memoryGateThreshold: readNumber(options, 'memoryGateThreshold', fallback.memoryGateThreshold),
    rerankEnabled: readBoolean(options, 'rerankEnabled', fallback.rerankEnabled ?? false),
  };
}

/** 创建一次执行使用的能力上下文；未知 feature 不会被丢弃。 */
export function createRuntimeContext(input: RuntimeContextInput = {}): RuntimeContext {
  const features = new Map<string, FeatureConfig>();
  for (const [id, value] of Object.entries(input.features ?? {})) {
    features.set(id, {
      enabled: value.enabled ?? true,
      options: isRecord(value.options) ? { ...value.options } : {},
    });
  }
  const readonlyFeatures = features as ReadonlyMap<string, FeatureConfig>;
  const fallbackJev = input.fallbackJev ?? DISABLED_JEV_SETTINGS;
  return {
    features: readonlyFeatures,
    getFeature: (id) => readonlyFeatures.get(id),
    getJevSettings: () => readJevSettings(readonlyFeatures.get('jev'), fallbackJev),
  };
}
