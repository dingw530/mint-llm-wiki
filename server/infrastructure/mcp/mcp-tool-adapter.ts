import { z } from 'zod';
import { BaseTool } from '../../agent-runtime/tooling/base-tool.js';
import type {
  McpToolRecord,
  ToolContext,
  ToolMetadata,
  ToolRiskLevel,
  ValidationResult,
} from '../../agent-runtime/tooling/tool-contracts.js';
export type { McpToolRecord } from '../../agent-runtime/tooling/tool-contracts.js';

export type McpToolInvoker = (
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

function matchesJsonSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (typeof schema.type !== 'string') return true;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const objectValue = value as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    if (required.some((key) => !(key in objectValue))) return false;
    return Object.entries(properties).every(
      ([key, propertySchema]) =>
        !(key in objectValue) || matchesJsonSchema(objectValue[key], propertySchema),
    );
  }
  if (schema.type === 'array') return Array.isArray(value);
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'number' || schema.type === 'integer')
    return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  return true;
}

function riskFor(description: string): ToolRiskLevel {
  return /delete|remove|write|send|create|update|upload|execute|run|publish|支付|删除|写入|发送|创建|执行/i.test(
    description,
  )
    ? 'high'
    : 'medium';
}

/** 将 MCP 工具适配为统一 Tool Runtime 可执行的工具。 */
export class McpToolAdapter extends BaseTool<Record<string, unknown>, unknown> {
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly executionTimeoutMs = 30_000;

  constructor(
    private readonly record: McpToolRecord,
    private readonly invoke: McpToolInvoker,
  ) {
    super();
  }

  get name(): string {
    return `${this.record.serverName}__${this.record.name}`;
  }
  get description(): string {
    return this.record.description;
  }

  getDefinition() {
    return {
      type: 'function' as const,
      function: {
        name: this.name,
        description: this.description,
        parameters: this.record.inputSchema || { type: 'object', properties: {} },
      },
    };
  }

  validate(input: unknown): ValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, error: 'MCP 工具参数必须是 JSON object' };
    }
    const required = Array.isArray(this.record.inputSchema?.required)
      ? (this.record.inputSchema.required as unknown[])
      : [];
    const missing = required.filter((key) => !((key as string) in input));
    if (missing.length > 0) return { valid: false, error: `缺少必填参数: ${missing.join(', ')}` };
    return matchesJsonSchema(input, this.record.inputSchema || {})
      ? { valid: true }
      : { valid: false, error: 'MCP 工具参数不符合 inputSchema' };
  }

  getMetadata(): ToolMetadata {
    return {
      source: 'mcp',
      serverName: this.record.serverName,
      riskLevel: riskFor(this.description),
      sideEffect: riskFor(this.description) === 'high' ? 'external' : 'none',
    };
  }

  isReadOnly(): boolean {
    return this.getMetadata().sideEffect === 'none';
  }
  isIdempotent(): boolean {
    return this.isReadOnly();
  }
  isConcurrencySafe(): boolean {
    return this.isReadOnly();
  }

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    if (context.signal?.aborted) throw new Error('MCP tool execution cancelled');
    return this.invoke(this.record.serverName, this.record.name, input);
  }
}
