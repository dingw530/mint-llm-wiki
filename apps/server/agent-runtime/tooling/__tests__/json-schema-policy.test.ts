import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeToolInputSchema } from '../json-schema-policy.js';
import { BaseTool } from '../base-tool.js';
import { BashTool } from '../../../infrastructure/tools/bash-tool.js';
import { HttpFetchTool } from '../../../infrastructure/tools/http-fetch-tool.js';
import { ReadArtifactTool } from '../../../infrastructure/tools/read-artifact-tool.js';
import { ReadFileTool } from '../../../application/tools/wiki/read-wiki-file-tool.js';
import { WriteFileTool } from '../../../application/tools/wiki/write-wiki-file-tool.js';
import { InvokeAgentTool } from '../../../application/tools/agents/invoke-agent-tool.js';
import { KnowledgeGraphTool } from '../../../application/tools/knowledge-graph/knowledge-graph-tool.js';
import { SkillTool } from '../../../application/tools/skills/skill-tool.js';
import { WikiIngestTool } from '../../../application/tools/wiki/wiki-ingest-tool.js';
import { WikiLintTool } from '../../../application/tools/wiki/wiki-lint-tool.js';
import { WikiSearchTool } from '../../../application/tools/wiki/wiki-search-tool.js';
import {
  DiscoverToolsTool,
  LoadToolTool,
} from '../../../application/tools/mcp/tool-catalog-tools.js';

class SchemaFixtureTool extends BaseTool<z.infer<typeof fixtureSchema>, string> {
  readonly name = 'schema_fixture';
  readonly description = 'schema fixture';
  readonly inputSchema = fixtureSchema;

  async execute(): Promise<string> {
    return 'ok';
  }
}

const fixtureSchema = z.object({
  required: z.string(),
  optionalWithDefault: z.string().optional().default('fallback'),
  mode: z.enum(['fast', 'safe']),
  nested: z.object({ value: z.number().int().min(1) }),
  rows: z.array(z.object({ label: z.string() })),
  headers: z.record(z.string(), z.string()),
});

describe('tool JSON Schema policy', () => {
  it('preserves constraints, closes objects, and excludes defaulted fields from required', () => {
    const schema = new SchemaFixtureTool().getDefinition().function.parameters;
    const properties = schema.properties as Record<string, Record<string, unknown>>;

    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['required', 'mode', 'nested', 'rows', 'headers']);
    expect(properties.mode.enum).toEqual(['fast', 'safe']);
    expect(properties.nested.additionalProperties).toBe(false);
    expect(properties.rows.items).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(properties.headers.additionalProperties).toEqual({ type: 'string' });
  });

  it('rejects schemas deeper than three nested object levels and open objects', () => {
    expect(() =>
      normalizeToolInputSchema({
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
      }),
    ).toThrow('object depth exceeds 3');
    expect(() =>
      normalizeToolInputSchema({
        type: 'object',
        properties: {},
        additionalProperties: true,
      }),
    ).toThrow('Open object schemas');
  });

  it('keeps every registered built-in tool schema within the contract', () => {
    const discovery = {
      getToolCatalog: () => [],
      getToolDefinition: () => undefined,
      markToolLoaded: () => undefined,
    };
    const tools = [
      new BashTool(),
      new HttpFetchTool(),
      new ReadArtifactTool(),
      new ReadFileTool(),
      new WriteFileTool(),
      new InvokeAgentTool(),
      new KnowledgeGraphTool(),
      new SkillTool(),
      new WikiIngestTool(),
      new WikiLintTool(),
      new WikiSearchTool(),
      new DiscoverToolsTool(discovery),
      new LoadToolTool(discovery),
    ];

    for (const tool of tools) {
      const schema = tool.inputSchema.toJSONSchema() as Record<string, unknown>;
      expect(() => normalizeToolInputSchema(schema), tool.name).not.toThrow();
    }
  });
});
