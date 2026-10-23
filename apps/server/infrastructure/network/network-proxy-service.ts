import { Agent, EnvHttpProxyAgent, setGlobalDispatcher, type Dispatcher } from 'undici';
import * as settingsRepository from '../config/settings-repository.js';

const PROXY_URL_KEY = 'networkProxyUrl';
const PROXY_ENABLED_KEY = 'networkProxyEnabled';
const PROXY_NO_PROXY_KEY = 'networkProxyNoProxy';
const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1';

export interface NetworkProxyInput {
  networkProxyEnabled?: boolean;
  networkProxyUrl?: string;
  networkProxyNoProxy?: string;
  networkProxyClearUrl?: boolean;
}

export interface VisibleNetworkProxySettings {
  networkProxyEnabled: boolean;
  networkProxyConfigured: boolean;
  networkProxyUrl: string;
  networkProxyNoProxy: string;
}

let activeDispatcher: Dispatcher | undefined;

/** 返回不含代理凭据的可见设置。 */
export function getVisibleNetworkProxySettings(): VisibleNetworkProxySettings | undefined {
  const settings = settingsRepository.getAll();
  if (
    settings[PROXY_ENABLED_KEY] === undefined &&
    settings[PROXY_URL_KEY] === undefined &&
    settings[PROXY_NO_PROXY_KEY] === undefined
  ) {
    return undefined;
  }
  return {
    networkProxyEnabled: settings[PROXY_ENABLED_KEY] === 'true',
    networkProxyConfigured: Boolean(settings[PROXY_URL_KEY]),
    networkProxyUrl: settings[PROXY_URL_KEY] || '',
    networkProxyNoProxy: settings[PROXY_NO_PROXY_KEY] || DEFAULT_NO_PROXY,
  };
}

/** 校验代理地址格式，避免错误配置污染全局请求出口。 */
export function validateNetworkProxyUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('代理地址必须是有效 URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('代理地址仅支持 http 或 https URL，且不能包含片段');
  }
}

/** 保存代理配置，并立即切换当前 Node 进程的全局出站连接器。 */
export function saveNetworkProxySettings(input: NetworkProxyInput): void {
  const current = settingsRepository.getAll();
  const nextEnabled = input.networkProxyEnabled ?? current[PROXY_ENABLED_KEY] === 'true';
  const nextUrl = input.networkProxyClearUrl
    ? ''
    : input.networkProxyUrl?.trim() || (nextEnabled ? current[PROXY_URL_KEY] || '' : '');
  if (nextEnabled && !nextUrl) throw new Error('启用网络代理前，请先配置代理地址');
  if (nextUrl && input.networkProxyUrl?.trim()) validateNetworkProxyUrl(nextUrl);

  const updates: Record<string, string> = {};
  if (input.networkProxyEnabled !== undefined || input.networkProxyClearUrl) {
    updates[PROXY_ENABLED_KEY] = String(nextEnabled);
  }
  if (input.networkProxyClearUrl) {
    updates[PROXY_URL_KEY] = '';
  } else if (input.networkProxyUrl?.trim()) {
    updates[PROXY_URL_KEY] = nextUrl;
  }
  if (input.networkProxyNoProxy !== undefined) {
    updates[PROXY_NO_PROXY_KEY] = input.networkProxyNoProxy.trim() || DEFAULT_NO_PROXY;
  }
  if (Object.keys(updates).length > 0) settingsRepository.upsertAll(updates);
  applyNetworkProxySettings();
}

/** 从持久化设置应用代理；关闭代理时使用直连 Agent，不读取环境代理变量。 */
export function applyNetworkProxySettings(): void {
  const settings = settingsRepository.getAll();
  const enabled = settings[PROXY_ENABLED_KEY] === 'true';
  const proxyUrl = enabled ? settings[PROXY_URL_KEY] || '' : '';
  if (enabled && !proxyUrl) throw new Error('网络代理已启用，但代理地址为空');

  let dispatcher: Dispatcher;
  if (enabled) {
    validateNetworkProxyUrl(proxyUrl);
    const configuredNoProxy = settings[PROXY_NO_PROXY_KEY] || DEFAULT_NO_PROXY;
    const noProxy = [...new Set([...configuredNoProxy.split(','), 'localhost', '127.0.0.1', '::1'])]
      .map((host) => host.trim())
      .filter(Boolean)
      .join(',');
    dispatcher = new EnvHttpProxyAgent({
      httpProxy: proxyUrl,
      httpsProxy: proxyUrl,
      noProxy,
    });
  } else {
    dispatcher = new Agent();
  }

  const previous = activeDispatcher;
  activeDispatcher = dispatcher;
  setGlobalDispatcher(dispatcher);
  if (previous) void previous.close().catch(() => undefined);
}

/** 释放代理连接池；由服务关闭流程调用。 */
export async function closeNetworkProxyDispatcher(): Promise<void> {
  const dispatcher = activeDispatcher;
  if (dispatcher) await dispatcher.close();
  const directDispatcher = new Agent();
  activeDispatcher = directDispatcher;
  setGlobalDispatcher(directDispatcher);
}
