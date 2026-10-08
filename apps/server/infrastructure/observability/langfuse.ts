import { context, trace } from '@opentelemetry/api';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  type LangfuseAgent,
  type LangfuseObservation,
  type LangfuseTool,
  startObservation,
} from '@langfuse/tracing';
import type { AgentRun } from '../../agent-runtime/agent-run.js';
import type { ReactEvent } from '../../agent-runtime/react-events.js';
import { createLogger } from './logger.js';

const observers = new WeakMap<AgentRun, LangfuseRunObserver>();
const log = createLogger('langfuse');
let tracingInitialized = false;
let spanProcessor: LangfuseSpanProcessor | undefined;

/** Returns whether production Langfuse tracing is explicitly enabled and configured. */
export function isLangfuseEnabled(): boolean {
  const enabled =
    process.env.MINT_LANGFUSE_ENABLED === 'true' &&
    Boolean(process.env.LANGFUSE_PUBLIC_KEY) &&
    Boolean(process.env.LANGFUSE_SECRET_KEY);
  if (enabled) initializeLangfuseTracing();
  return enabled;
}

/** Returns whether model inputs and outputs may be sent to Langfuse. */
export function shouldCaptureLangfuseContent(): boolean {
  return (
    process.env.NODE_ENV === 'development' || process.env.MINT_LANGFUSE_CAPTURE_CONTENT === 'true'
  );
}

/** Initializes the Langfuse OpenTelemetry exporter once for the server process. */
export function initializeLangfuseTracing(): void {
  if (tracingInitialized || process.env.MINT_LANGFUSE_ENABLED !== 'true') return;
  tracingInitialized = true;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    log.warn('langfuse_tracing_not_initialized', { reason: 'missing_credentials' });
    return;
  }

  spanProcessor = new LangfuseSpanProcessor({
    environment: process.env.MINT_LANGFUSE_ENVIRONMENT || process.env.NODE_ENV || 'development',
  });
  const sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
  sdk.start();
  log.info('langfuse_tracing_initialized', {
    environment: process.env.MINT_LANGFUSE_ENVIRONMENT || process.env.NODE_ENV || 'development',
    captureContent: shouldCaptureLangfuseContent(),
  });
}

/** Installs a non-blocking AgentRun observer for the production durable run factory. */
export function attachLangfuseObserver(run: AgentRun): void {
  if (!isLangfuseEnabled() || observers.has(run)) return;

  try {
    const observer = new LangfuseRunObserver(run);
    observers.set(run, observer);
    run.subscribe((event) => observer.handle(event));
  } catch (error) {
    log.warn('langfuse_observer_initialization_failed', { error: safeLogError(error) });
  }
}

/** Runs an operation with the current AgentRun observation as its OpenTelemetry parent. */
export function withLangfuseAgentContext<T>(run: AgentRun, operation: () => T): T {
  const observer = observers.get(run);
  if (!observer) return operation();
  return observer.withActiveContext(operation);
}

/** Runs one ReAct model round with its Langfuse round observation as parent. */
export function withLangfuseRoundContext<T>(run: AgentRun, round: number, operation: () => T): T {
  const observer = observers.get(run);
  if (!observer) return operation();
  return observer.withRoundContext(round, operation);
}

/** Flushes queued Langfuse spans during an explicit server shutdown. */
export async function flushLangfuseTracing(): Promise<void> {
  if (!spanProcessor) return;
  log.info('langfuse_flush_started');
  try {
    await spanProcessor.forceFlush();
    log.info('langfuse_flush_completed');
  } catch (error) {
    log.error('langfuse_flush_failed', { error: safeLogError(error) });
    throw error;
  }
}

class LangfuseRunObserver {
  private readonly agent: LangfuseAgent;
  private readonly tools = new Map<string, LangfuseTool>();
  private readonly rounds = new Map<number, LangfuseObservation>();
  private roundCount = 0;

  constructor(private readonly run: AgentRun) {
    this.agent = startObservation(
      'mint-agent-run',
      {
        metadata: {
          mintRunId: run.runId,
          ...(run.getSnapshot().conversationId
            ? { conversationId: run.getSnapshot().conversationId }
            : {}),
          environment:
            process.env.MINT_LANGFUSE_ENVIRONMENT || process.env.NODE_ENV || 'development',
        },
      },
      { asType: 'agent' },
    );
    log.info('langfuse_trace_started', {
      runId: run.runId,
      traceId: this.agent.traceId,
    });
  }

  handle(event: ReactEvent): void {
    try {
      switch (event.type) {
        case 'round_started':
          this.startRound(event.round);
          break;
        case 'tool_call_start':
          this.startTool(event);
          break;
        case 'tool_call_end':
          this.finishTool(event);
          break;
        case 'tool_call_error':
          this.updateToolError(event);
          break;
        case 'approval_required':
          this.markApprovalRequired(event);
          break;
        case 'run_completed':
          this.finishRun({ output: event.content, status: 'completed' });
          break;
        case 'run_failed':
          this.finishRun({ error: event.error, status: 'failed' });
          break;
        case 'run_cancelled':
          this.finishRun({ status: 'cancelled' });
          break;
        default:
          break;
      }
    } catch (error) {
      log.warn('langfuse_observer_event_failed', {
        runId: this.run.runId,
        eventType: event.type,
        error: safeLogError(error),
      });
    }
  }

  withActiveContext<T>(operation: () => T): T {
    const activeContext = trace.setSpan(context.active(), this.agent.otelSpan);
    return context.with(activeContext, operation);
  }

  withRoundContext<T>(round: number, operation: () => T): T {
    const parent = this.rounds.get(round);
    if (!parent) return this.withActiveContext(operation);
    const activeContext = trace.setSpan(context.active(), parent.otelSpan);
    return context.with(activeContext, operation);
  }

  private startRound(round: number): void {
    this.endPreviousRounds(round);
    this.roundCount = Math.max(this.roundCount, round);
    this.rounds.set(
      round,
      this.agent.startObservation('react-round', {
        metadata: { round },
      }),
    );
  }

  private startTool(event: Extract<ReactEvent, { type: 'tool_call_start' }>): void {
    const parent = this.rounds.get(event.round) || this.agent;
    const tool = parent.startObservation(
      `tool:${event.toolName}`,
      {
        ...(shouldCaptureLangfuseContent() ? { input: safeLangfuseValue(event.arguments) } : {}),
        metadata: { callId: event.callId, toolName: event.toolName, round: event.round },
      },
      { asType: 'tool' },
    );
    this.tools.set(event.callId, tool);
    log.info('langfuse_tool_observation_started', {
      runId: this.run.runId,
      traceId: this.agent.traceId,
      callId: event.callId,
      toolName: event.toolName,
      round: event.round,
    });
  }

  private finishTool(event: Extract<ReactEvent, { type: 'tool_call_end' }>): void {
    const tool = this.tools.get(event.callId);
    if (!tool) return;
    tool.update({
      ...(shouldCaptureLangfuseContent() ? { output: safeLangfuseValue(event.result) } : {}),
      metadata: {
        status: event.status,
        ...(event.duration !== undefined ? { durationMs: event.duration } : {}),
      },
    });
    tool.end();
    this.tools.delete(event.callId);
    log.info('langfuse_tool_observation_finished', {
      runId: this.run.runId,
      traceId: this.agent.traceId,
      callId: event.callId,
      toolName: event.toolName,
      status: event.status,
      ...(event.duration !== undefined ? { durationMs: event.duration } : {}),
    });
  }

  private updateToolError(event: Extract<ReactEvent, { type: 'tool_call_error' }>): void {
    const tool = this.tools.get(event.callId);
    if (!tool) return;
    tool.update({
      level:
        event.status === 'approval_required'
          ? 'WARNING'
          : event.phase === 'final'
            ? 'ERROR'
            : 'WARNING',
      statusMessage: safeLangfuseText(event.error),
      metadata: { phase: event.phase, status: event.status, retryCount: event.retryCount },
    });
    log.warn('langfuse_tool_observation_error', {
      runId: this.run.runId,
      traceId: this.agent.traceId,
      callId: event.callId,
      toolName: event.toolName,
      phase: event.phase,
      status: event.status,
      retryCount: event.retryCount,
    });
    if (event.status !== 'approval_required' && event.phase === 'final') {
      tool.end();
      this.tools.delete(event.callId);
    }
  }

  private markApprovalRequired(event: Extract<ReactEvent, { type: 'approval_required' }>): void {
    this.tools.get(event.callId)?.update({
      level: 'WARNING',
      statusMessage: 'approval_required',
      metadata: { approvalId: event.approvalId || 'unknown' },
    });
    log.warn('langfuse_tool_observation_approval_required', {
      runId: this.run.runId,
      traceId: this.agent.traceId,
      callId: event.callId,
      toolName: event.toolName,
    });
  }

  private finishRun(result: { output?: string; error?: string; status: string }): void {
    this.endOpenTools();
    this.rounds.forEach((round) => round.end());
    this.rounds.clear();
    this.agent.update({
      ...(shouldCaptureLangfuseContent() && result.output !== undefined
        ? { output: safeLangfuseValue(result.output) }
        : {}),
      level: result.status === 'completed' ? 'DEFAULT' : 'ERROR',
      ...(result.error ? { statusMessage: safeLangfuseText(result.error) } : {}),
      metadata: { status: result.status, roundCount: this.roundCount },
    });
    this.agent.end();
    log.info('langfuse_trace_finished', {
      runId: this.run.runId,
      traceId: this.agent.traceId,
      status: result.status,
    });
  }

  private endPreviousRounds(currentRound: number): void {
    for (const [roundNumber, round] of this.rounds) {
      if (roundNumber >= currentRound) continue;
      round.end();
      this.rounds.delete(roundNumber);
    }
  }

  private endOpenTools(): void {
    this.tools.forEach((tool) => tool.end());
    this.tools.clear();
  }
}

function safeLangfuseText(value: string): string {
  const redacted = value.replace(
    /((?:api[-_]?key|authorization|cookie|password|secret|token|credential)\s*[:=]\s*)[^\s,;}]+/gi,
    '$1[REDACTED]',
  );
  return redacted.length > 1000 ? `${redacted.slice(0, 1000)}…` : redacted;
}

function safeLangfuseValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return safeLangfuseText(value);
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => safeLangfuseValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          isSensitiveKey(key) ? '[REDACTED]' : safeLangfuseValue(item, depth + 1),
        ]),
    );
  }
  return '[UNSERIALIZABLE]';
}

function isSensitiveKey(key: string): boolean {
  return /(?:api[-_]?key|authorization|cookie|password|secret|token|credential)/i.test(key);
}

function safeLogError(error: unknown): string {
  return safeLangfuseText(error instanceof Error ? error.message : String(error));
}
