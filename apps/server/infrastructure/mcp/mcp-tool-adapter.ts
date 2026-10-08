import { z } from 'zod';
import { BaseTool } from '../../agent-runtime/tooling/base-tool.js';
import type {
  McpToolRecord,
  ToolContext,
  ToolMetadata,
  ValidationResult,
} from '../../agent-runtime/tooling/tool-contracts.js';
import { compileMcpInputSchema } from './mcp-input-schema.js';
export type { McpToolRecord } from '../../agent-runtime/tooling/tool-contracts.js';

export type McpToolInvoker = (
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** 将 MCP 工具适配为统一 Tool Runtime 可执行的工具。 */
export class McpToolAdapter extends BaseTool<Record<string, unknown>, unknown> {
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly executionTimeoutMs = 30_000;
  private readonly inputSchemaValidator: ReturnType<typeof compileMcpInputSchema>;

  constructor(
    private readonly record: McpToolRecord,
    private readonly invoke: McpToolInvoker,
  ) {
    super();
    this.inputSchemaValidator = compileMcpInputSchema(
      record.inputSchema || { type: 'object', properties: {} },
    );
  }

  get name(): string {
    return `${this.record.serverName}__${this.record.name}`;
  }
  get description(): string {
    return this.record.description;
  }

  getDefinition() {
    if (this.inputSchemaValidator.error) {
      throw new Error(this.inputSchemaValidator.error);
    }
    return {
      type: 'function' as const,
      function: {
        name: this.name,
        description: this.description,
        parameters: this.inputSchemaValidator.schema,
      },
    };
  }

  validate(input: unknown): ValidationResult {
    if (this.inputSchemaValidator.error) {
      return { valid: false, error: this.inputSchemaValidator.error };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, error: 'MCP 工具参数必须是 JSON object' };
    }
    return this.inputSchemaValidator.validate(input)
      ? { valid: true }
      : { valid: false, error: 'MCP 工具参数不符合 inputSchema' };
  }

  isEnabled(): boolean {
    return this.inputSchemaValidator.error === undefined;
  }

  getMetadata(): ToolMetadata {
    return {
      source: 'mcp',
      serverName: this.record.serverName,
      riskLevel: 'high',
      sideEffect: 'external',
      approvalMode: 'always',
      retrySafety: 'never',
    };
  }

  isReadOnly(): boolean {
    return false;
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
