import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ──
// vi.mock factory is hoisted — use vi.hoisted to make variables available

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
}));

import { McpToolAdapter } from '../mcp-tool-adapter.js';
import type { McpToolRecord } from '../mcp-tool-adapter.js';

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

  it('should assign medium risk for read-only tools', () => {
    const tool = createMcpTool(readToolRecord);
    const meta = tool.getMetadata();
    expect(meta.source).toBe('mcp');
    expect(meta.riskLevel).toBe('medium');
    expect(meta.serverName).toBe('filesystem');
  });

  it('should assign high risk for write/delete tools', () => {
    const tool = createMcpTool(writeToolRecord);
    expect(tool.getMetadata().riskLevel).toBe('high');
  });

  it('should be read-only when sideEffect is none', () => {
    const tool = createMcpTool(readToolRecord);
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isIdempotent()).toBe(true);
    expect(tool.isConcurrencySafe()).toBe(true);
  });

  it('should not be read-only when sideEffect is external', () => {
    const tool = createMcpTool(writeToolRecord);
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isIdempotent()).toBe(false);
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
    expect(def.function.parameters).toEqual(readToolRecord.inputSchema);
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
