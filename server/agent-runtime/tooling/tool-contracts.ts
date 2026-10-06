import type { RuntimeContext } from './runtime-context.js';
import type { ToolDefinition } from '../../types.js';

export interface ToolContext {
  conversationId: string;
  runtimeContext?: RuntimeContext;
  userId?: string;
  signal?: AbortSignal;
  approvalGranted?: boolean;
  allowedWorkingDirectory?: string;
  wikiPath?: string;
  audit?: (event: ToolAuditEvent) => void;
  requestApproval?: (request: { reason: string }) => string;
  [key: string]: unknown;
}

export interface ToolAuditEvent {
  event:
    | 'started'
    | 'policy_denied'
    | 'approval_required'
    | 'executing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed_out';
  toolName: string;
  source: ToolMetadata['source'];
  riskLevel: ToolMetadata['riskLevel'];
  conversationId: string;
  duration?: number;
  reason?: string;
  error?: string;
  approvalId?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type ToolExecutionMode = 'sync' | 'async';
export type ToolSource = 'builtin' | 'mcp';
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ToolSideEffect = 'none' | 'filesystem' | 'network' | 'external';

export interface ToolMetadata {
  source: ToolSource;
  serverName?: string;
  riskLevel: ToolRiskLevel;
  sideEffect: ToolSideEffect;
  requiresApproval?: boolean;
}

export interface McpToolRecord {
  serverName: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export type ToolPolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'approval_required'; reason: string };

export interface ToolHandler<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly executionMode: ToolExecutionMode;
  readonly executionTimeoutMs?: number;
  isEnabled(): boolean;
  isReadOnly(): boolean;
  isIdempotent(): boolean;
  isConcurrencySafe(): boolean;
  getMetadata(): ToolMetadata;
  validate(input: unknown): ValidationResult;
  checkPermission(input: Input, context: ToolContext): PermissionResult;
  execute(input: Input, context: ToolContext): Promise<Output>;
  getDefinition(): ToolDefinition;
  getCallSummary(input: Input): string | undefined;
  getResultSummary(result: Output): string | undefined;
}
