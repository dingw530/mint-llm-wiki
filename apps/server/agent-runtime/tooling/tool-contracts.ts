import type { RuntimeContext } from './runtime-context.js';
import type { ToolDefinition } from '../../types.js';

export type RetrySafety = 'safe' | 'idempotency_key' | 'never';
export type ToolInvocationOutcome = 'succeeded' | 'failed' | 'outcome_unknown';

export type ToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'TOOL_DISABLED'
  | 'INVALID_TOOL_INPUT'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'POLICY_DENIED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'TOOL_FAILED'
  | 'OUTCOME_UNKNOWN'
  | 'INVOCATION_CONFLICT'
  | 'INVOCATION_ALREADY_COMPLETED'
  | 'INVOCATION_STATE_UNAVAILABLE';

export type ToolInvocationClaim =
  | { allowed: true; attempt: number }
  | {
      allowed: false;
      errorCode: ToolErrorCode;
      message: string;
    };

export interface ToolInvocationControl {
  invocationId: string;
  claim(input: {
    inputHash: string;
    toolName: string;
    retrySafety: RetrySafety;
  }): ToolInvocationClaim;
  finish(input: {
    status: ToolInvocationOutcome;
    retryable: boolean;
    errorCode?: ToolErrorCode;
  }): void;
}

export interface ToolInvocationFinish {
  status: ToolInvocationOutcome;
  retryable: boolean;
  errorCode?: ToolErrorCode;
}

export interface ToolContext {
  conversationId: string;
  runtimeContext?: RuntimeContext;
  userId?: string;
  signal?: AbortSignal;
  approvalGranted?: boolean;
  invocationId?: string;
  runId?: string;
  callId?: string;
  allowedWorkingDirectory?: string;
  wikiPath?: string;
  audit?: (event: ToolAuditEvent) => void;
  invocation?: ToolInvocationControl;
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
  invocationId?: string;
  runId?: string;
  callId?: string;
  resultCode?: ToolAuditResultCode;
  errorCode?: ToolErrorCode;
  retryCount?: number;
  parameterSummary?: string;
}

export type ToolAuditResultCode =
  | 'success'
  | 'invalid_input'
  | 'permission_denied'
  | 'approval_required'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'outcome_unknown';

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
/**
 * 工具元数据声明的审批模式。
 * - `none`：元数据不要求审批。
 * - `always`：始终要求审批。
 * - `conditional`：审批条件由工具自身在 `evaluateToolPolicy` 的分支中裁决（参见 bash / http_fetch /
 *   knowledge_graph）。若工具声明了 `conditional` 却没有实现对应分支，策略会按最保守解释处理为需要审批。
 */
export type ToolApprovalMode = 'none' | 'conditional' | 'always';

export interface ToolMetadata {
  source: ToolSource;
  serverName?: string;
  riskLevel: ToolRiskLevel;
  sideEffect: ToolSideEffect;
  approvalMode?: ToolApprovalMode;
  retrySafety?: RetrySafety;
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
