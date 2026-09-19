import * as settingsRepo from '../../repositories/settingsRepository.js';
import * as endpointRepo from '../../repositories/endpointRepository.js';
import { encrypt, decrypt, maskApiKey } from '../utils/encryption.js';
import type {
  RawSettings,
  SettingsInput,
  AiSettings,
  JevSettings,
  VisibleSettings,
} from '../../types.js';
import * as fs from 'fs';
import * as path from 'path';

const WIKI_SCHEMA = {
  version: 1,
  description: 'LLM Wiki 规范 — Schema 层',
  sourcesDir: 'sources',
  pagesDir: 'pages',
  tags: [],
  categories: [],
  pageTemplate: {
    required_frontmatter: ['title', 'created', 'source'],
  },
};

const WIKI_INDEX_CONTENT = `# Wiki 首页

这是 LLM Wiki 知识库的首页。

## 分类索引

## 最近更新

`;

const WIKI_MANIFEST_CONTENT =
  JSON.stringify(
    {
      version: 1,
      entries: [],
    },
    null,
    2,
  ) + '\n';

export const DEFAULT_EMBEDDING_API_URL = 'http://127.0.0.1:11434/v1';
export const DEFAULT_EMBEDDING_MODEL = 'bge-m3';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;
export const DEFAULT_CHROMA_URL = 'http://127.0.0.1:8000';

// ── Jev 实验功能默认值 ──

export const DEFAULT_JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_JEV_MODEL = 'jev-latest';
export const DEFAULT_JEV_TIMEOUT_MS = 3_000;
export const MIN_JEV_TIMEOUT_MS = 500;
export const MAX_JEV_TIMEOUT_MS = 15_000;
/** Jev 路由步的置信度门槛起步值；低于该值回退原有路由。 */
export const DEFAULT_JEV_ROUTING_MIN_CONFIDENCE = 0.5;
/** 记忆门控的 noul 门槛；故意偏低，因为漏记的代价高于多记。 */
export const DEFAULT_JEV_MEMORY_GATE_THRESHOLD = 0.4;

function getSearchMode(raw: RawSettings): 'keyword' | 'hybrid' {
  return raw.wikiSearchMode === 'hybrid' ? 'hybrid' : 'keyword';
}

function getEmbeddingDimensions(raw: RawSettings): number {
  const dimensions = Number.parseInt(
    raw.embeddingDimensions || String(DEFAULT_EMBEDDING_DIMENSIONS),
    10,
  );
  return Number.isFinite(dimensions) && dimensions > 0 ? dimensions : DEFAULT_EMBEDDING_DIMENSIONS;
}

function getVectorStore(raw: RawSettings): 'sqlite' | 'chroma' {
  return raw.vectorStore === 'chroma' ? 'chroma' : 'sqlite';
}

function getMaskedSecret(value: string | undefined): string {
  if (!value) return '';
  try {
    return maskApiKey(decrypt(value));
  } catch {
    return '****';
  }
}

/**
 * 把配置值夹到合法区间；非数字输入退回默认值。
 * @param value 原始字符串
 * @param min 下限
 * @param max 上限
 * @param fallback 无法解析时的默认值
 * @returns 夹取后的整数
 */
function clampInt(
  value: string | number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 把配置值夹到 [0, 1]；非数字输入退回默认值。
 * @param value 原始字符串
 * @param fallback 无法解析时的默认值
 * @returns 夹取后的概率值
 */
function clampScore(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * 解密密钥；失败时返回空字符串，调用方按"未配置"处理。
 * @param value 加密后的密钥
 * @returns 明文密钥
 */
function safeDecrypt(value: string | undefined): string {
  if (!value) return '';
  try {
    return decrypt(value);
  } catch {
    return '';
  }
}

/** Jev 设置的写入入参。 */
type JevSettingsInput = Pick<
  SettingsInput,
  | 'jevApiUrl'
  | 'jevApiKey'
  | 'jevModel'
  | 'jevTimeoutMs'
  | 'jevRoutingEnabled'
  | 'jevRoutingMinConfidence'
  | 'jevRoutingBypassOnKeyword'
  | 'jevMemoryEnabled'
  | 'jevMemoryGateThreshold'
>;

/**
 * 把 Jev 设置写入待持久化的键值表。
 * 非密钥字段一律落默认值（与 `save` 的既有全量覆盖契约一致），密钥仅在提供新值时写入。
 * @param target 待写入的键值表
 * @param input Jev 相关入参
 */
function applyJevSettings(target: Record<string, string>, input: JevSettingsInput): void {
  target.jevApiUrl = input.jevApiUrl || DEFAULT_JEV_API_URL;
  target.jevModel = input.jevModel || DEFAULT_JEV_MODEL;
  target.jevTimeoutMs = String(
    clampInt(input.jevTimeoutMs, MIN_JEV_TIMEOUT_MS, MAX_JEV_TIMEOUT_MS, DEFAULT_JEV_TIMEOUT_MS),
  );
  target.jevRoutingEnabled = input.jevRoutingEnabled ? 'true' : 'false';
  target.jevRoutingMinConfidence = String(
    clampScore(input.jevRoutingMinConfidence, DEFAULT_JEV_ROUTING_MIN_CONFIDENCE),
  );
  target.jevRoutingBypassOnKeyword =
    input.jevRoutingBypassOnKeyword !== undefined
      ? String(input.jevRoutingBypassOnKeyword)
      : 'true';
  target.jevMemoryEnabled = input.jevMemoryEnabled ? 'true' : 'false';
  target.jevMemoryGateThreshold = String(
    clampScore(input.jevMemoryGateThreshold, DEFAULT_JEV_MEMORY_GATE_THRESHOLD),
  );
  if (input.jevApiKey) target.jevApiKey = encrypt(input.jevApiKey);
}

function ensureWikiPath(wikiPath: string): void {
  if (!wikiPath) return;
  try {
    const resolved = path.resolve(wikiPath);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    // Schema 层：_schema.json
    const schemaPath = path.join(resolved, '_schema.json');
    if (!fs.existsSync(schemaPath)) {
      fs.writeFileSync(schemaPath, JSON.stringify(WIKI_SCHEMA, null, 2), 'utf-8');
    }
    // 首页
    const indexPath = path.join(resolved, '_index.md');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, WIKI_INDEX_CONTENT, 'utf-8');
    }
    // 摄入追溯清单
    const manifestPath = path.join(resolved, '_manifest.json');
    if (!fs.existsSync(manifestPath)) {
      fs.writeFileSync(manifestPath, WIKI_MANIFEST_CONTENT, 'utf-8');
    }
    // Sources 层
    const sourcesDir = path.join(resolved, 'sources');
    if (!fs.existsSync(sourcesDir)) {
      fs.mkdirSync(sourcesDir, { recursive: true });
      fs.writeFileSync(path.join(sourcesDir, '.gitkeep'), '');
    }
    // Wiki 知识层
    const pagesDir = path.join(resolved, 'pages');
    if (!fs.existsSync(pagesDir)) {
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, '.gitkeep'), '');
    }
  } catch (err) {
    console.error('[settingsService] Failed to initialize wiki path:', err);
  }
}

// 获取脱敏后的设置（API Key 解密后重新掩码）
export function get(): VisibleSettings {
  const raw: RawSettings = settingsRepo.getAll();
  let apiKeyMasked = '';
  if (raw.apiKey) {
    try {
      apiKeyMasked = maskApiKey(decrypt(raw.apiKey));
    } catch {
      apiKeyMasked = '****'; // 解密失败（如密钥变更），显示掩码
    }
  }
  const activeEndpoint = endpointRepo.getActive();
  return {
    apiUrl: raw.apiUrl || '',
    apiKeyMasked,
    modelId: raw.modelId || '',
    systemPrompt: raw.systemPrompt || '',
    thinkingMode: raw.thinkingMode === 'true',
    memoryEnabled: raw.memoryEnabled === 'true',
    routingMode: raw.routingMode || 'auto',
    reactMaxIterations: parseInt(raw.reactMaxIterations || '5', 10),
    toolMaxRetries: parseInt(raw.toolMaxRetries || '5', 10),
    showReactSteps: raw.showReactSteps !== 'false',
    maxContextRounds: parseInt(raw.maxContextRounds || '10', 10),
    activeEndpointId: activeEndpoint?.id || null,
    activeEndpointName: activeEndpoint?.name || null,
    wikiPath: raw.wikiPath || '',
    wikiMaxFileSize: parseInt(raw.wikiMaxFileSize || '10485760', 10),
    wikiSearchMode: getSearchMode(raw),
    embeddingApiUrl: raw.embeddingApiUrl || DEFAULT_EMBEDDING_API_URL,
    embeddingModel: raw.embeddingModel || DEFAULT_EMBEDDING_MODEL,
    embeddingDimensions: getEmbeddingDimensions(raw),
    vectorStore: getVectorStore(raw),
    chromaUrl: raw.chromaUrl || DEFAULT_CHROMA_URL,
    chromaApiKeyMasked: getMaskedSecret(raw.chromaApiKey),
    ...getVisibleJevSettings(),
  };
}

/** Returns the decrypted Chroma API key for server-side connection checks. */
export function getChromaApiKey(): string {
  const raw: RawSettings = settingsRepo.getAll();
  if (!raw.chromaApiKey) return '';
  try {
    return decrypt(raw.chromaApiKey);
  } catch {
    return '';
  }
}

/**
 * 读取 Jev 实验设置；所有默认值集中在此单一出口。
 *
 * 刻意不并入 `AiSettings`：Jev 是自包含子系统，只被 jevClient 与路由/记忆 provider 消费，
 * 而 `AiSettings` 有 60+ 处消费方且带有重复的返回分支。
 *
 * @returns 已解密并带默认值的 Jev 设置
 */
export function getJevSettings(): JevSettings {
  const raw: RawSettings = settingsRepo.getAll();
  return {
    apiUrl: raw.jevApiUrl || DEFAULT_JEV_API_URL,
    apiKey: safeDecrypt(raw.jevApiKey),
    model: raw.jevModel || DEFAULT_JEV_MODEL,
    timeoutMs: clampInt(
      raw.jevTimeoutMs,
      MIN_JEV_TIMEOUT_MS,
      MAX_JEV_TIMEOUT_MS,
      DEFAULT_JEV_TIMEOUT_MS,
    ),
    routingEnabled: raw.jevRoutingEnabled === 'true',
    routingMinConfidence: clampScore(
      raw.jevRoutingMinConfidence,
      DEFAULT_JEV_ROUTING_MIN_CONFIDENCE,
    ),
    routingBypassOnKeyword: raw.jevRoutingBypassOnKeyword !== 'false',
    memoryEnabled: raw.jevMemoryEnabled === 'true',
    memoryGateThreshold: clampScore(raw.jevMemoryGateThreshold, DEFAULT_JEV_MEMORY_GATE_THRESHOLD),
  };
}

/**
 * 返回给前端的 Jev 可见设置；API Key 只以掩码形式出现。
 * @returns 掩码后的 Jev 设置
 */
export function getVisibleJevSettings(): Pick<
  VisibleSettings,
  | 'jevApiUrl'
  | 'jevModel'
  | 'jevApiKeyMasked'
  | 'jevRoutingEnabled'
  | 'jevRoutingMinConfidence'
  | 'jevMemoryEnabled'
  | 'jevMemoryGateThreshold'
> {
  const raw: RawSettings = settingsRepo.getAll();
  return {
    jevApiUrl: raw.jevApiUrl || DEFAULT_JEV_API_URL,
    jevModel: raw.jevModel || DEFAULT_JEV_MODEL,
    jevApiKeyMasked: getMaskedSecret(raw.jevApiKey),
    jevRoutingEnabled: raw.jevRoutingEnabled === 'true',
    jevRoutingMinConfidence: clampScore(
      raw.jevRoutingMinConfidence,
      DEFAULT_JEV_ROUTING_MIN_CONFIDENCE,
    ),
    jevMemoryEnabled: raw.jevMemoryEnabled === 'true',
    jevMemoryGateThreshold: clampScore(
      raw.jevMemoryGateThreshold,
      DEFAULT_JEV_MEMORY_GATE_THRESHOLD,
    ),
  };
}

// 获取内部使用的 AI 设置（优先从激活端点读取，兜底旧 settings）
export function getAiSettings(): AiSettings {
  const activeEndpoint = endpointRepo.getActive();
  if (activeEndpoint) {
    let apiKey = '';
    if (activeEndpoint.apiKey) {
      try {
        apiKey = decrypt(activeEndpoint.apiKey);
      } catch {
        apiKey = '';
      }
    }
    const raw: RawSettings = settingsRepo.getAll();
    return {
      apiUrl: activeEndpoint.apiUrl,
      apiKey,
      modelId: activeEndpoint.modelId,
      apiType: activeEndpoint.apiType || 'openai-chat',
      systemPrompt: raw.systemPrompt || '',
      thinkingMode: raw.thinkingMode === 'true',
      memoryEnabled: raw.memoryEnabled === 'true',
      reactMaxIterations: parseInt(raw.reactMaxIterations || '5', 10),
      toolMaxRetries: parseInt(raw.toolMaxRetries || '5', 10),
      showReactSteps: raw.showReactSteps !== 'false',
      maxContextRounds: parseInt(raw.maxContextRounds || '10', 10),
      wikiPath: raw.wikiPath || '',
      wikiMaxFileSize: parseInt(raw.wikiMaxFileSize || '10485760', 10),
      wikiSearchMode: getSearchMode(raw),
      embeddingApiUrl: raw.embeddingApiUrl || DEFAULT_EMBEDDING_API_URL,
      embeddingModel: raw.embeddingModel || DEFAULT_EMBEDDING_MODEL,
      embeddingDimensions: getEmbeddingDimensions(raw),
      vectorStore: getVectorStore(raw),
      chromaUrl: raw.chromaUrl || DEFAULT_CHROMA_URL,
      chromaApiKey: raw.chromaApiKey ? decrypt(raw.chromaApiKey) : '',
    };
  }
  // 兜底：旧 settings 表（过渡期兼容）
  // @deprecated — 新安装用户应通过 model_endpoints 配置
  const raw: RawSettings = settingsRepo.getAll();
  return {
    apiUrl: raw.apiUrl || '',
    apiKey: raw.apiKey ? decrypt(raw.apiKey) : '',
    modelId: raw.modelId || 'gpt-4o-mini',
    apiType: 'openai-chat',
    systemPrompt: raw.systemPrompt || '',
    thinkingMode: raw.thinkingMode === 'true',
    memoryEnabled: raw.memoryEnabled === 'true',
    reactMaxIterations: parseInt(raw.reactMaxIterations || '5', 10),
    toolMaxRetries: parseInt(raw.toolMaxRetries || '5', 10),
    showReactSteps: raw.showReactSteps !== 'false',
    maxContextRounds: parseInt(raw.maxContextRounds || '10', 10),
    wikiPath: raw.wikiPath || '',
    wikiMaxFileSize: parseInt(raw.wikiMaxFileSize || '10485760', 10),
    wikiSearchMode: getSearchMode(raw),
    embeddingApiUrl: raw.embeddingApiUrl || DEFAULT_EMBEDDING_API_URL,
    embeddingModel: raw.embeddingModel || DEFAULT_EMBEDDING_MODEL,
    embeddingDimensions: getEmbeddingDimensions(raw),
    vectorStore: getVectorStore(raw),
    chromaUrl: raw.chromaUrl || DEFAULT_CHROMA_URL,
    chromaApiKey: raw.chromaApiKey ? decrypt(raw.chromaApiKey) : '',
  };
}

// 保存设置：API Key 加密后写入，仅在有新 key 时更新
// @deprecated — 同步端点逻辑将在后续版本移除，前端直接操作 model_endpoints 接口
export function save({
  apiUrl,
  apiKey,
  modelId,
  systemPrompt,
  thinkingMode,
  memoryEnabled,
  routingMode,
  reactMaxIterations,
  toolMaxRetries,
  showReactSteps,
  wikiPath,
  wikiMaxFileSize,
  wikiSearchMode,
  embeddingApiUrl,
  embeddingModel,
  embeddingDimensions,
  vectorStore,
  chromaUrl,
  chromaApiKey,
  jevApiUrl,
  jevApiKey,
  jevModel,
  jevTimeoutMs,
  jevRoutingEnabled,
  jevRoutingMinConfidence,
  jevRoutingBypassOnKeyword,
  jevMemoryEnabled,
  jevMemoryGateThreshold,
}: SettingsInput): void {
  const settings: Record<string, string> = {
    systemPrompt: systemPrompt || '',
    thinkingMode: thinkingMode ? 'true' : 'false',
    memoryEnabled: memoryEnabled ? 'true' : 'false',
    routingMode: routingMode || 'auto',
    reactMaxIterations: String(reactMaxIterations ?? 5),
    toolMaxRetries: String(toolMaxRetries ?? 5),
    showReactSteps: showReactSteps !== undefined ? String(showReactSteps) : 'true',
    wikiPath: wikiPath || '',
    wikiMaxFileSize: String(wikiMaxFileSize ?? 10485760),
    wikiSearchMode: wikiSearchMode === 'hybrid' ? 'hybrid' : 'keyword',
    embeddingApiUrl: embeddingApiUrl || DEFAULT_EMBEDDING_API_URL,
    embeddingModel: embeddingModel || DEFAULT_EMBEDDING_MODEL,
    embeddingDimensions: String(embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS),
    vectorStore: vectorStore === 'chroma' ? 'chroma' : 'sqlite',
    chromaUrl: chromaUrl || DEFAULT_CHROMA_URL,
  };
  applyJevSettings(settings, {
    jevApiUrl,
    jevApiKey,
    jevModel,
    jevTimeoutMs,
    jevRoutingEnabled,
    jevRoutingMinConfidence,
    jevRoutingBypassOnKeyword,
    jevMemoryEnabled,
    jevMemoryGateThreshold,
  });
  if (apiUrl !== undefined) settings.apiUrl = apiUrl;
  if (modelId !== undefined) settings.modelId = modelId;
  if (apiKey) {
    settings.apiKey = encrypt(apiKey);
  }
  if (chromaApiKey) {
    settings.chromaApiKey = encrypt(chromaApiKey);
  }
  settingsRepo.upsertAll(settings);

  // 自动初始化 Wiki 目录
  if (wikiPath) {
    ensureWikiPath(wikiPath);
  }

  // 同步到激活端点
  const activeEndpoint = endpointRepo.getActive();
  if (activeEndpoint) {
    const fields: Record<string, unknown> = {};
    if (apiUrl !== undefined) fields.apiUrl = apiUrl;
    if (apiKey) fields.apiKey = encrypt(apiKey);
    if (modelId !== undefined) fields.modelId = modelId;
    if (Object.keys(fields).length > 0) {
      endpointRepo.update(activeEndpoint.id, fields);
    }
  }
}
