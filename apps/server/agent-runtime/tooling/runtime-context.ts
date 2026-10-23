import type { JevSettings } from '../../types.js';
import type {
  JsonValue,
  SessionEvent,
  SessionEventDraft,
  SessionStoredModelMessage,
  SessionToolStatus,
} from '@mint/session';

/** 本轮语义日志需要记录的已授权工具分派事实。 */
export interface SessionToolDispatchRecord {
  readonly callId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
  readonly retrySafety: 'safe' | 'idempotency_key' | 'never';
}

/** 本轮语义日志需要记录的模型可见工具结果。 */
export interface SessionToolResultRecord {
  readonly callId: string;
  readonly toolName: string;
  readonly status: Extract<
    SessionToolStatus,
    'success' | 'failed' | 'cancelled' | 'outcome_unknown'
  >;
  readonly durationMs?: number;
  readonly message: SessionStoredModelMessage;
}

/** 对 ReAct、普通 stream 与工具执行边界提供的可选会话记录 Port。 */
export interface SessionRecordingPort {
  record(events: readonly SessionEventDraft[]): readonly SessionEvent[];
  recordModelMessage(
    round: number,
    messages: readonly SessionStoredModelMessage[],
    messageId?: string,
  ): SessionEvent;
  recordToolCatalog(round: number, tools: readonly JsonValue[]): SessionEvent;
  recordContextSnapshot(input: {
    round: number;
    scope: 'system' | 'anchor' | 'runtime' | 'history';
    operation: 'append' | 'replace' | 'clear';
    source: string;
    anchorMessageId?: string;
    messages: readonly SessionStoredModelMessage[];
  }): SessionEvent;
  recordToolDispatch(input: SessionToolDispatchRecord): SessionEvent;
  recordToolResult(input: SessionToolResultRecord): SessionEvent;
  recordApproval(input: {
    readonly callId: string;
    readonly toolName: string;
    readonly status: 'requested' | 'approved' | 'denied' | 'expired';
    readonly reason?: string;
  }): SessionEvent;
  recordRunTerminal(outcome: 'completed' | 'failed' | 'cancelled'): SessionEvent;
  recordInterrupted(
    reason?: 'process_exit' | 'approval_expired' | 'lease_expired' | 'unknown',
  ): SessionEvent;
  pauseForApproval(callId: string, ttlMs: number): void;
  close(): void;
}

/** Disabled feature fallback used when an execution does not inject Jev settings. */
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
  rerankEnabled: false,
};

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
  readonly sessionRecorder?: SessionRecordingPort;
  readonly assistantMessageId?: string;
  readonly recoveryActionId?: string;
  getFeature(id: string): FeatureConfig | undefined;
  getJevSettings(): JevSettings;
}

interface RuntimeContextInput {
  features?: FeatureConfigInput;
  fallbackJev?: JevSettings;
  sessionRecorder?: SessionRecordingPort;
  assistantMessageId?: string;
  recoveryActionId?: string;
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
    ...(input.sessionRecorder ? { sessionRecorder: input.sessionRecorder } : {}),
    ...(input.assistantMessageId ? { assistantMessageId: input.assistantMessageId } : {}),
    ...(input.recoveryActionId ? { recoveryActionId: input.recoveryActionId } : {}),
    getFeature: (id) => readonlyFeatures.get(id),
    getJevSettings: () => readJevSettings(readonlyFeatures.get('jev'), fallbackJev),
  };
}
