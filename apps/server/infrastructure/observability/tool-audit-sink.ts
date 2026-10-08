import type { ToolAuditEvent } from '../../agent-runtime/tooling/tool-contracts.js';
import { createLogger } from './logger.js';

const logger = createLogger('tool-audit');

/** Writes a fixed whitelist of tool-call fields to the structured application log. */
export interface ToolAuditSink {
  record(event: ToolAuditEvent): void;
}

/** Logger-backed sink that never persists raw tool input, output, or error text. */
export class StructuredToolAuditSink implements ToolAuditSink {
  record(event: ToolAuditEvent): void {
    try {
      logger.info('tool_invocation_event', {
        event: event.event,
        invocationId: event.invocationId,
        runId: event.runId,
        callId: event.callId,
        toolName: event.toolName,
        source: event.source,
        riskLevel: event.riskLevel,
        durationMs: event.duration,
        resultCode: event.resultCode,
        errorCode: event.errorCode,
        retryCount: event.retryCount,
        parameterSummary: event.parameterSummary,
      });
    } catch {
      // Audit logging must not change an authorization or execution outcome.
    }
  }
}

export const toolAuditSink: ToolAuditSink = new StructuredToolAuditSink();

/** Summarizes only input shape and size; input values and property names are omitted. */
export function summarizeToolParameters(input: unknown): string {
  const counts = {
    objects: 0,
    objectFields: 0,
    arrays: 0,
    arrayItems: 0,
    strings: 0,
    stringChars: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
  };
  visitValue(input, counts, 0);
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(',')
    .slice(0, 160);
}

function visitValue(
  value: unknown,
  counts: Record<
    | 'objects'
    | 'objectFields'
    | 'arrays'
    | 'arrayItems'
    | 'strings'
    | 'stringChars'
    | 'numbers'
    | 'booleans'
    | 'nulls',
    number
  >,
  depth: number,
): void {
  if (depth > 4) return;
  if (value === null) {
    counts.nulls += 1;
    return;
  }
  if (Array.isArray(value)) {
    counts.arrays += 1;
    const items = value.slice(0, 20);
    counts.arrayItems += items.length;
    for (const item of items) visitValue(item, counts, depth + 1);
    return;
  }
  if (typeof value === 'string') {
    counts.strings += 1;
    counts.stringChars += Math.min(value.length, 1_000_000);
  } else if (typeof value === 'number') counts.numbers += 1;
  else if (typeof value === 'boolean') counts.booleans += 1;
  else if (typeof value === 'object') {
    counts.objects += 1;
    const values = Object.values(value).slice(0, 40);
    counts.objectFields += values.length;
    for (const item of values) visitValue(item, counts, depth + 1);
  }
}
