import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ──
// vi.mock factory is hoisted — use vi.hoisted to make variables available

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
}));

import { McpToolAdapter } from '../mcp-tool-adapter.js';
import type { McpToolRecord } from '../mcp-tool-adapter.js';
import { ToolExecutor } from '../../../application/agent-runtime/tooling/tool-executor.js';
import { ToolRegistry } from '../../../application/agent-runtime/tooling/tool-registry.js';

const createMcpTool = (record: McpToolRecord) => new McpToolAdapter(record, mockCallTool);

const ctx = { conversationId: 'test-conv' };

describe('McpToolAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const readToolRecord = {
    serverName: 'filesystem',
    name: 'read_file',
    description: 'Read file content from the filesystem',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path' } },
      required: ['path'],
    },
  };

  const writeToolRecord = {
    serverName: 'filesystem',
    name: 'write_file',
    description: 'Write content to a file on the filesystem',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  };

  it('should derive name from server and tool name', () => {
    const tool = createMcpTool(readToolRecord);
    expect(tool.name).toBe('filesystem__read_file');
  });

  it('should delegate description to record', () => {
    const tool = createMcpTool(readToolRecord);
    expect(tool.description).toBe('Read file content from the filesystem');
  });

  it('should validate valid input', () => {
    const tool = createMcpTool(readToolRecord);
    expect(tool.validate({ path: '/tmp/file.txt' }).valid).toBe(true);
  });

  it('should reject missing required fields', () => {
    const tool = createMcpTool(readToolRecord);
    expect(tool.validate({}).valid).toBe(false);
  });

  it('should reject non-object input', () => {
    const tool = createMcpTool(readToolRecord);
    expect(tool.validate(null).valid).toBe(false);
    expect(tool.validate(42).valid).toBe(false);
  });

  it('should accept input without required fields when schema has none', () => {
    const tool = createMcpTool({
      serverName: 'search',
      name: 'search_web',
      description: 'Search the web',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    });
    expect(tool.validate({}).valid).toBe(true);
  });

  it('requires approval for MCP reads because remote hints are not authorization', () => {
    const tool = createMcpTool(readToolRecord);
    const meta = tool.getMetadata();
    expect(meta.source).toBe('mcp');
    expect(meta.riskLevel).toBe('high');
    expect(meta.approvalMode).toBe('always');
    expect(meta.serverName).toBe('filesystem');
  });

  it('should require approval for MCP tools without a trusted read-only annotation', () => {
    const tool = createMcpTool(writeToolRecord);
    expect(tool.getMetadata().riskLevel).toBe('high');
    expect(tool.getMetadata().approvalMode).toBe('always');
  });

  it('should treat all MCP calls as side-effecting for local approval and retry policy', () => {
    const tool = createMcpTool(readToolRecord);
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isIdempotent()).toBe(false);
    expect(tool.isConcurrencySafe()).toBe(false);
  });

  it('should not be read-only when the server omits readOnlyHint', () => {
    const tool = createMcpTool(writeToolRecord);
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isIdempotent()).toBe(false);
  });

  it('requires approval before invoking MCP read tools too', async () => {
    const tool = createMcpTool(readToolRecord);
    const registry = new ToolRegistry();
    registry.register(tool);
    const result = await new ToolExecutor(registry).execute(
      tool.name,
      { path: '/tmp/test.txt' },
      { ...ctx, requestApproval: () => 'approval-mcp-1' },
    );

    expect(result).toMatchObject({
      success: false,
      approvalRequired: { approvalId: 'approval-mcp-1' },
    });
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('should delegate execution to mcpService.callTool', async () => {
    mockCallTool.mockResolvedValue({ content: 'file content' });
    const tool = createMcpTool(readToolRecord);
    const result = await tool.execute({ path: '/tmp/file.txt' }, ctx);
    expect(mockCallTool).toHaveBeenCalledWith('filesystem', 'read_file', { path: '/tmp/file.txt' });
    expect(result).toEqual({ content: 'file content' });
  });

  it('should throw when execution is cancelled via signal', async () => {
    const tool = createMcpTool(readToolRecord);
    await expect(
      tool.execute({ path: '/tmp/file.txt' }, { ...ctx, signal: AbortSignal.abort() }),
    ).rejects.toThrow('cancelled');
  });

  it('should propagate MCP errors', async () => {
    mockCallTool.mockRejectedValue(new Error('MCP server not connected'));
    const tool = createMcpTool(readToolRecord);
    await expect(tool.execute({ path: '/tmp/file.txt' }, ctx)).rejects.toThrow(
      'MCP server not connected',
    );
  });

  it('should return function definition with original schema', () => {
    const tool = createMcpTool(readToolRecord);
    const def = tool.getDefinition();
    expect(def.type).toBe('function');
    expect(def.function.name).toBe('filesystem__read_file');
    expect(def.function.parameters).toEqual({
      ...readToolRecord.inputSchema,
      additionalProperties: false,
    });
  });

  it('should validate enum values', () => {
    const tool = createMcpTool({
      serverName: 'test',
      name: 'enum_test',
      description: 'test enum',
      inputSchema: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['fast', 'slow'] } },
        required: ['mode'],
      },
    });
    expect(tool.validate({ mode: 'fast' }).valid).toBe(true);
    expect(tool.validate({ mode: 'medium' }).valid).toBe(false);
  });

  it('validates JSON Schema string, numeric, array, nested, and additional-property constraints', () => {
    const tool = createMcpTool({
      serverName: 'test',
      name: 'constrained',
      description: 'constrained inputs',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fast', 'safe'] },
          text: { type: 'string', minLength: 2, maxLength: 8, pattern: '^x+$' },
          count: { type: 'integer', minimum: 1, maximum: 4 },
          values: { type: 'array', items: { type: 'integer', minimum: 0 } },
          nested: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
          },
        },
        required: ['mode', 'text', 'count', 'values', 'nested'],
      },
    });
    const valid = { mode: 'fast', text: 'xxx', count: 2, values: [0, 1], nested: { name: 'ok' } };

    expect(tool.validate(valid).valid).toBe(true);
    expect(tool.validate({ ...valid, text: 'x' }).valid).toBe(false);
    expect(tool.validate({ ...valid, text: 'bad!' }).valid).toBe(false);
    expect(tool.validate({ ...valid, count: 5 }).valid).toBe(false);
    expect(tool.validate({ ...valid, values: ['1'] }).valid).toBe(false);
    expect(tool.validate({ ...valid, nested: { name: 'ok', extra: true } }).valid).toBe(false);
    expect(tool.validate({ ...valid, extra: true }).valid).toBe(false);
  });

  it('fails closed for remote refs and unsupported JSON Schema keywords', () => {
    for (const inputSchema of [
      { type: 'object', properties: { value: { $ref: 'https://example.com/schema' } } },
      { type: 'object', properties: { value: { type: 'string', unsafeRule: true } } },
      { type: 'object', properties: { value: { type: 'string', pattern: '^(a+)+$' } } },
    ]) {
      const tool = createMcpTool({
        serverName: 'test',
        name: 'invalid_schema',
        description: 'invalid schema',
        inputSchema,
      });
      expect(tool.isEnabled()).toBe(false);
      expect(tool.validate({ value: 'x' }).valid).toBe(false);
      expect(() => tool.getDefinition()).toThrow('inputSchema is invalid');
    }
  });

  it('never invokes the remote server when a loaded schema is invalid', async () => {
    const tool = createMcpTool({
      serverName: 'test',
      name: 'invalid_schema',
      description: 'invalid schema',
      inputSchema: {
        type: 'object',
        properties: { value: { $ref: 'https://example.com/schema' } },
      },
    });
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await new ToolExecutor(registry).execute(tool.name, { value: 'x' }, ctx);

    expect(result.success).toBe(false);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('rejects input schemas deeper than three object levels', () => {
    const tool = createMcpTool({
      serverName: 'test',
      name: 'too_deep',
      description: 'too deep',
      inputSchema: {
        type: 'object',
        properties: {
          one: {
            type: 'object',
            properties: {
              two: {
                type: 'object',
                properties: { three: { type: 'object', properties: {} } },
              },
            },
          },
        },
      },
    });
    expect(tool.isEnabled()).toBe(false);
    expect(tool.validate({}).valid).toBe(false);
  });

  it('should validate nested object properties', () => {
    const tool = createMcpTool({
      serverName: 'test',
      name: 'nested',
      description: 'nested schema',
      inputSchema: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: { host: { type: 'string' }, port: { type: 'integer' } },
            required: ['host'],
          },
        },
        required: ['config'],
      },
    });
    expect(tool.validate({ config: { host: 'localhost', port: 8080 } }).valid).toBe(true);
    expect(tool.validate({ config: {} }).valid).toBe(false);
  });
});
