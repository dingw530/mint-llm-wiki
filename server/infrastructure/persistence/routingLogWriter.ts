import { v4 as uuidv4 } from 'uuid';
import type { RouteResult, RoutingContext } from '../../domains/routing/index.js';
import { create } from './routingLogRepository.js';

/** Persist a completed route using the existing routing_logs schema and audit method. */
export function recordRoute(result: RouteResult, context: RoutingContext, method: string): void {
  create({
    id: uuidv4(),
    conversation_id: context.conversationId ?? null,
    message_id: context.messageId || null,
    agent_id: result.agentId,
    confidence: result.confidence,
    method,
    latency_ms: result.latencyMs,
    message_preview: context.messagePreview || null,
    locked_agent: context.lockedAgent || null,
    routing_mode: context.routingMode || null,
    created_at: new Date().toISOString(),
  });
}
