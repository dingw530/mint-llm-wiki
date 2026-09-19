import type { JevSettings } from '../../types.js';
import type { JevConfig } from './types.js';

/**
 * 关闭态配置，用作"实验功能不可用"时的兜底输入。
 * 与 settingsService 的真实默认值不同：这里表示两个子开关都关闭、且没有可用凭据。
 */
export const DISABLED_JEV_SETTINGS: JevSettings = {
  apiUrl: '',
  apiKey: '',
  model: '',
  timeoutMs: 0,
  routingEnabled: false,
  routingMinConfidence: 0,
  routingBypassOnKeyword: false,
  memoryEnabled: false,
  memoryGateThreshold: 0,
};

/**
 * 把设置层的 Jev 配置映射为客户端调用配置。
 * @param settings 已解密并带默认值的 Jev 设置
 * @returns `callJev` 所需的连接配置
 */
export function toJevConfig(settings: JevSettings): JevConfig {
  return {
    apiUrl: settings.apiUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    timeoutMs: settings.timeoutMs,
  };
}
