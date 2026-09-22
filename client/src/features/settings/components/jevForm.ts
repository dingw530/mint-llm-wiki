import type { SettingsInput, VisibleSettings } from '@/types';

/**
 * Jev 实验功能的表单状态。
 *
 * 只把 `apiKey`（新值，初始为空）与 `apiKeyMasked`（展示用掩码）分开保存，
 * 保证保存时不会把掩码当成新密钥回传。
 */
export interface JevFormState {
  apiUrl: string;
  apiKey: string;
  apiKeyMasked: string;
  model: string;
  routingEnabled: boolean;
  routingMinConfidence: number;
  memoryEnabled: boolean;
  memoryGateThreshold: number;
  rerankEnabled: boolean;
}

export const DEFAULT_JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_JEV_MODEL = 'jev-latest';
export const DEFAULT_JEV_ROUTING_MIN_CONFIDENCE = 0.5;
export const DEFAULT_JEV_MEMORY_GATE_THRESHOLD = 0.4;

/** 首次渲染与设置加载前的占位初值；两个子开关默认关闭。 */
export function createEmptyJevFormState(): JevFormState {
  return {
    apiUrl: DEFAULT_JEV_API_URL,
    apiKey: '',
    apiKeyMasked: '',
    model: DEFAULT_JEV_MODEL,
    routingEnabled: false,
    routingMinConfidence: DEFAULT_JEV_ROUTING_MIN_CONFIDENCE,
    memoryEnabled: false,
    memoryGateThreshold: DEFAULT_JEV_MEMORY_GATE_THRESHOLD,
    rerankEnabled: false,
  };
}

/**
 * 由服务端返回的可见设置构造表单初值。
 * 缺失字段一律回落到默认值，避免旧版本后端导致崩溃。
 * @param visible 服务端返回的设置
 * @returns 表单状态
 */
export function createJevFormState(visible: Partial<VisibleSettings>): JevFormState {
  const defaults = createEmptyJevFormState();
  return {
    apiUrl: visible.jevApiUrl || defaults.apiUrl,
    apiKey: '',
    apiKeyMasked: visible.jevApiKeyMasked || '',
    model: visible.jevModel || defaults.model,
    routingEnabled: visible.jevRoutingEnabled === true,
    routingMinConfidence:
      typeof visible.jevRoutingMinConfidence === 'number'
        ? visible.jevRoutingMinConfidence
        : defaults.routingMinConfidence,
    memoryEnabled: visible.jevMemoryEnabled === true,
    memoryGateThreshold:
      typeof visible.jevMemoryGateThreshold === 'number'
        ? visible.jevMemoryGateThreshold
        : defaults.memoryGateThreshold,
    rerankEnabled: visible.jevRerankEnabled === true,
  };
}

/**
 * 把表单值转换成保存入参。
 * API Key 留空时不下发 `jevApiKey`，服务端会保留已存密钥。
 * @param form 表单状态
 * @returns 可并入 `saveSettings` 的 Jev 字段
 */
export function toJevSettingsInput(
  form: JevFormState,
): Pick<
  SettingsInput,
  | 'jevApiUrl'
  | 'jevApiKey'
  | 'jevModel'
  | 'jevRoutingEnabled'
  | 'jevRoutingMinConfidence'
  | 'jevMemoryEnabled'
  | 'jevMemoryGateThreshold'
  | 'jevRerankEnabled'
> {
  return {
    jevApiUrl: form.apiUrl.trim(),
    jevModel: form.model.trim(),
    jevRoutingEnabled: form.routingEnabled,
    jevRoutingMinConfidence: form.routingMinConfidence,
    jevMemoryEnabled: form.memoryEnabled,
    jevMemoryGateThreshold: form.memoryGateThreshold,
    jevRerankEnabled: form.rerankEnabled,
    ...(form.apiKey ? { jevApiKey: form.apiKey } : {}),
  };
}
