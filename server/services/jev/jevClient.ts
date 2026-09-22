import { getErrorMessage, isRecord, readNumber, readString } from '../../utils/typeGuards.js';
import type {
  JevAnswer,
  JevCallResult,
  JevChoiceAnswer,
  JevConfig,
  JevFailureReason,
  JevNoulAnswer,
  JevRequest,
  JevScoreAnswer,
  JevState,
} from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('jev');

/** 单次 Jev 调用的默认总墙钟预算（毫秒）。超时后由调用方静默回退。 */
export const JEV_TIMEOUT_MS = 3_000;

/** 含首次在内的最大尝试次数。 */
const MAX_ATTEMPTS = 3;

/** 退避基数；第 n 次重试等待 `RETRY_BASE_DELAY_MS * 2^(n-1)`。 */
const RETRY_BASE_DELAY_MS = 300;

/** 低于该剩余预算就不再发起新尝试，避免请求刚发出就被总预算掐断。 */
const MIN_ATTEMPT_BUDGET_MS = 250;

export interface JevCallOptions {
  /** 可选的外部取消信号。 */
  signal?: AbortSignal;
  /** 用于结构化日志的业务调用名称。 */
  operation?: string;
}

function safeLogValue(value: string): string {
  return value.replace(/[^\w:./-]/g, '').slice(0, 120);
}

function endpointOrigin(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return 'invalid';
  }
}

function stateSummary(state: JevState): Record<string, unknown> {
  if (typeof state === 'string') return { stateShape: 'string', stateChars: state.length };
  if (Array.isArray(state)) {
    return {
      stateShape: 'array',
      stateItems: state.length,
      stateChars: state.reduce((total, item) => total + item.length, 0),
    };
  }
  return {
    stateShape: 'object',
    stateFields: Object.keys(state).length,
    stateChars: Object.values(state).reduce((total, item) => total + item.length, 0),
  };
}

function requestLogData(config: JevConfig, request: JevRequest, operation: string) {
  return {
    operation: safeLogValue(operation),
    endpointOrigin: endpointOrigin(config.apiUrl),
    model: safeLogValue(config.model),
    timeoutMs: config.timeoutMs,
    questionCount: Object.keys(request.questions).length,
    ...stateSummary(request.state),
  };
}

/**
 * 把数值夹到 [0, 1]。用于 confidence 与 noul，二者定义域都是概率。
 * @param value 原始数值
 * @returns 夹取后的概率值
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 把 HTTP 状态码映射为可审计的失败原因。
 * 仅 401 / 422 / 429 / 529 是文档定义的语义错误，其余一律归为 network_error。
 * @param status HTTP 状态码
 * @returns 失败原因
 */
export function classifyJevStatus(status: number): JevFailureReason {
  if (status === 401) return 'invalid_key';
  if (status === 422) return 'invalid_request';
  if (status === 429) return 'rate_limited';
  if (status === 529) return 'overloaded';
  return 'network_error';
}

/** 判断失败原因是否值得重试；只有限流与过载需要退避重试。 */
function isRetryable(reason: JevFailureReason): boolean {
  return reason === 'rate_limited' || reason === 'overloaded';
}

/**
 * 解析单个 Choice 答案；结构不符返回 undefined。
 * @param value 未知的答案载荷
 * @returns 归一化答案或 undefined
 */
function parseChoiceAnswer(value: Record<string, unknown>): JevChoiceAnswer | undefined {
  const choice = readString(value, 'choice');
  if (choice === undefined) return undefined;
  return { type: 'choice', choice, confidence: clamp01(readNumber(value, 'confidence') ?? 0) };
}

/**
 * 解析单个 Score 答案；结构不符返回 undefined。
 * @param value 未知的答案载荷
 * @returns 归一化答案或 undefined
 */
function parseScoreAnswer(value: Record<string, unknown>): JevScoreAnswer | undefined {
  const score = readNumber(value, 'score');
  if (score === undefined) return undefined;
  const legend = Array.isArray(value.legend)
    ? value.legend.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    type: 'score',
    score,
    legend,
    confidence: clamp01(readNumber(value, 'confidence') ?? 0),
  };
}

/**
 * 解析单个 Noul 答案；结构不符返回 undefined。
 * @param value 未知的答案载荷
 * @returns 归一化答案或 undefined
 */
function parseNoulAnswer(value: Record<string, unknown>): JevNoulAnswer | undefined {
  const noul = readNumber(value, 'noul');
  return noul === undefined ? undefined : { type: 'noul', noul: clamp01(noul) };
}

/** 按 `type` 分派单个答案的解析；未知类型返回 undefined。 */
function parseJevAnswer(value: unknown): JevAnswer | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'choice') return parseChoiceAnswer(value);
  if (value.type === 'score') return parseScoreAnswer(value);
  if (value.type === 'noul') return parseNoulAnswer(value);
  return undefined;
}

/**
 * 解析响应中的 `answers`，逐 key 收窄且不使用类型断言。
 * 单个 key 结构不符只跳过该 key，不影响其他 key；整体不可解析时返回 undefined。
 * @param value 响应中的 `answers` 字段
 * @returns 归一化答案表，或 undefined 表示载荷不可用
 */
export function parseJevAnswers(value: unknown): Record<string, JevAnswer> | undefined {
  if (!isRecord(value)) return undefined;
  const answers: Record<string, JevAnswer> = {};
  for (const [key, raw] of Object.entries(value)) {
    const answer = parseJevAnswer(raw);
    if (answer) answers[key] = answer;
  }
  return answers;
}

/** 等待指定毫秒。退避等待本身很短，且受总预算约束，因此不做取消。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 发起一次尝试，受剩余预算与外部取消信号共同约束。
 * @param config Jev 连接配置
 * @param request 已构造好的请求
 * @param budgetMs 本次尝试的墙钟预算（毫秒）
 * @param externalSignal 可选的外部取消信号
 * @returns 归一化答案或失败原因
 */
async function attemptJev(
  config: JevConfig,
  request: JevRequest,
  budgetMs: number,
  externalSignal?: AbortSignal,
): Promise<JevCallResult> {
  const startedAt = Date.now();
  const signals = [AbortSignal.timeout(budgetMs)];
  if (externalSignal) signals.push(externalSignal);
  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.any(signals),
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        reason: classifyJevStatus(response.status),
        status: response.status,
        message: `Jev 返回 HTTP ${response.status}`,
        latencyMs,
      };
    }
    const payload: unknown = await response.json();
    const answers = parseJevAnswers(isRecord(payload) ? payload.answers : undefined);
    if (!answers) {
      return {
        ok: false,
        reason: 'malformed_response',
        status: response.status,
        message: 'Jev 响应缺少可解析的 answers',
        latencyMs,
      };
    }
    return { ok: true, answers, latencyMs };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error',
      message: getErrorMessage(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** 构造"未配置"结果；未配置时不应发出任何请求。 */
function notConfigured(): JevCallResult {
  return { ok: false, reason: 'not_configured', message: 'Jev API Key 未配置', latencyMs: 0 };
}

/**
 * 调用一次 System One。
 *
 * - 未配置 API Key 或端点时立即返回 `not_configured`，不发出请求。
 * - 429 / 529 指数退避重试，退避与重试都受 `config.timeoutMs` 总预算约束。
 * - 超时映射为 `timeout`，外部取消与网络错误映射为 `network_error`。
 * - 响应体结构不符映射为 `malformed_response`。
 *
 * 永不抛出业务异常：调用方按 `ok` 分支处理，失败时静默回退。
 *
 * @param config Jev 连接配置
 * @param request 已构造好的 state 与 questions
 * @param options 可选的外部取消信号
 * @returns 归一化答案或失败原因
 */
export async function callJev(
  config: JevConfig,
  request: JevRequest,
  options: JevCallOptions = {},
): Promise<JevCallResult> {
  const operation = options.operation ?? 'system_one';
  const logData = requestLogData(config, request, operation);
  log.info('jev_call_started', logData);
  if (!config.apiKey.trim() || !config.apiUrl.trim()) {
    const result = notConfigured();
    log.warn('jev_call_failed', {
      ...logData,
      failureReason: 'not_configured',
      attempts: 0,
      latencyMs: 0,
    });
    return result;
  }

  const deadline = Date.now() + config.timeoutMs;
  let lastResult: JevCallResult | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_BUDGET_MS) break;

    const result = await attemptJev(config, request, remaining, options.signal);
    if (result.ok) {
      log.info('jev_call_succeeded', {
        ...logData,
        attempts: attempt,
        latencyMs: result.latencyMs,
        answerCount: Object.keys(result.answers).length,
      });
      return result;
    }

    lastResult = result;
    if (!isRetryable(result.reason) || attempt === MAX_ATTEMPTS) {
      log.warn('jev_call_failed', {
        ...logData,
        attempts: attempt,
        latencyMs: result.latencyMs,
        failureReason: result.reason,
        ...(result.status === undefined ? {} : { status: result.status }),
      });
      return result;
    }

    const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    if (Date.now() + backoff >= deadline) {
      log.warn('jev_call_failed', {
        ...logData,
        attempts: attempt,
        latencyMs: result.latencyMs,
        failureReason: result.reason,
        retrySkipped: 'budget_exhausted',
      });
      return result;
    }
    log.warn('jev_retry_scheduled', {
      ...logData,
      attempt,
      nextAttempt: attempt + 1,
      retryDelayMs: backoff,
      failureReason: result.reason,
    });
    await sleep(backoff);
  }

  const result = lastResult ?? {
    ok: false,
    reason: 'timeout',
    message: 'Jev 调用未获得可用预算',
    latencyMs: config.timeoutMs,
  };
  log.warn('jev_call_failed', {
    ...logData,
    attempts: MAX_ATTEMPTS,
    latencyMs: result.latencyMs,
    failureReason: result.reason,
  });
  return result;
}
