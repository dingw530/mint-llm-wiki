import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { normalizeToolInputSchema } from '../../agent-runtime/tooling/json-schema-policy.js';

export interface McpInputSchemaValidator {
  schema: Record<string, unknown>;
  validate(input: unknown): boolean;
  error?: string;
}

/**
 * Compiles a bounded MCP input schema without allowing network reference loading.
 * @param schema Schema supplied by the connected MCP server.
 * @returns A normalized schema and validator, or a fail-closed error result.
 */
export function compileMcpInputSchema(schema: Record<string, unknown>): McpInputSchemaValidator {
  try {
    const normalized = normalizeToolInputSchema(schema);
    const declaredDialect = normalized.$schema;
    if (
      declaredDialect !== undefined &&
      declaredDialect !== 'https://json-schema.org/draft/2020-12/schema'
    ) {
      throw new Error('Only JSON Schema 2020-12 is supported for MCP tool inputs');
    }

    const ajv = new Ajv2020({
      strict: true,
      allErrors: false,
      addUsedSchema: false,
      coerceTypes: false,
      removeAdditional: false,
      validateFormats: true,
    });
    addFormats.default(ajv, { mode: 'fast' });
    const validate = ajv.compile(normalized);
    return {
      schema: normalized,
      validate: (input) => validate(input) === true,
    };
  } catch {
    return {
      schema: { type: 'object', properties: {}, additionalProperties: false },
      validate: () => false,
      error: 'MCP inputSchema is invalid or exceeds the supported contract',
    };
  }
}
