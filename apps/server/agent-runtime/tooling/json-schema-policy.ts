const MAX_TOOL_SCHEMA_BYTES = 64 * 1024;
const MAX_TOOL_SCHEMA_NODES = 512;
const MAX_TOOL_SCHEMA_OBJECT_DEPTH = 3;
const MAX_SCHEMA_PATTERN_LENGTH = 256;
const UNSAFE_NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)[+*{]/;
const VALIDATION_KEYWORDS = new Set([
  '$ref',
  'type',
  'enum',
  'const',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxContains',
  'minContains',
  'maxProperties',
  'minProperties',
  'required',
  'properties',
  'patternProperties',
  'additionalProperties',
  'propertyNames',
  'items',
  'prefixItems',
  'contains',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'format',
]);

type JsonSchema = boolean | Record<string, unknown>;

/**
 * Normalizes a tool argument schema to a bounded, closed JSON object contract.
 * @param inputSchema Schema emitted by Zod or supplied by an MCP server.
 * @returns A JSON-safe schema whose objects reject undeclared fields.
 */
export function normalizeToolInputSchema(inputSchema: unknown): Record<string, unknown> {
  let source: unknown;
  let serialized: string;
  try {
    serialized = JSON.stringify(inputSchema);
    source = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('Tool input schema must be valid JSON');
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAX_TOOL_SCHEMA_BYTES) {
    throw new Error(`Tool input schema exceeds ${MAX_TOOL_SCHEMA_BYTES} bytes`);
  }
  if (!isSchemaObject(source) || !isObjectSchema(source)) {
    throw new Error('Tool input schema root must be an object schema');
  }

  let nodeCount = 0;
  const closeObjects = (schema: JsonSchema): JsonSchema => {
    if (typeof schema === 'boolean') {
      if (schema) throw new Error('Unbounded boolean schemas are not supported');
      return false;
    }
    nodeCount += 1;
    if (nodeCount > MAX_TOOL_SCHEMA_NODES) {
      throw new Error(`Tool input schema exceeds ${MAX_TOOL_SCHEMA_NODES} nodes`);
    }

    const normalized: Record<string, unknown> = { ...schema };
    if (isObjectSchema(normalized)) {
      if (normalized.additionalProperties === true) {
        throw new Error('Open object schemas are not supported');
      }
      if (normalized.additionalProperties === undefined) {
        normalized.additionalProperties = false;
      }
    }

    for (const key of ['properties', 'patternProperties', '$defs', 'definitions'] as const) {
      const children = normalized[key];
      if (!isSchemaObject(children)) continue;
      normalized[key] = Object.fromEntries(
        Object.entries(children).map(([name, child]) => [name, closeObjects(asJsonSchema(child))]),
      );
      if (key === 'patternProperties') {
        for (const pattern of Object.keys(children)) validatePattern(pattern);
      }
    }

    for (const key of [
      'items',
      'additionalProperties',
      'propertyNames',
      'contains',
      'not',
      'if',
      'then',
      'else',
    ] as const) {
      const child = normalized[key];
      if (isJsonSchema(child)) normalized[key] = closeObjects(child);
    }

    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const) {
      const children = normalized[key];
      if (Array.isArray(children)) {
        normalized[key] = children.map((child) => closeObjects(asJsonSchema(child)));
      }
    }

    if (typeof normalized.pattern === 'string') validatePattern(normalized.pattern);
    return normalized;
  };

  const normalized = closeObjects(source);
  if (typeof normalized === 'boolean' || !isObjectSchema(normalized)) {
    throw new Error('Tool input schema root must be an object schema');
  }
  if (normalized.type === undefined) normalized.type = 'object';
  if (normalized.type !== 'object') {
    throw new Error('Tool input schema root type must be object');
  }
  validateObjectDepth(normalized);
  validateConstrainedNodes(normalized);
  return normalized;
}

/**
 * Counts nested object schemas, following local references and rejecting recursion.
 * @param root Normalized JSON Schema root.
 */
function validateObjectDepth(root: Record<string, unknown>): void {
  const activeRefs = new Set<string>();

  const visit = (schema: JsonSchema, depth: number): void => {
    if (typeof schema === 'boolean') return;
    const currentDepth = depth + (isObjectSchema(schema) ? 1 : 0);
    if (currentDepth > MAX_TOOL_SCHEMA_OBJECT_DEPTH) {
      throw new Error(`Tool input schema object depth exceeds ${MAX_TOOL_SCHEMA_OBJECT_DEPTH}`);
    }

    if (typeof schema.$ref === 'string') {
      const reference = schema.$ref;
      if (!reference.startsWith('#/')) {
        throw new Error('External and root JSON Schema references are not supported');
      }
      if (activeRefs.has(reference))
        throw new Error('Recursive tool input schemas are not supported');
      const target = resolveLocalReference(root, reference);
      activeRefs.add(reference);
      visit(asJsonSchema(target), depth);
      activeRefs.delete(reference);
    }

    for (const key of ['properties', 'patternProperties'] as const) {
      const children = schema[key];
      if (!isSchemaObject(children)) continue;
      for (const child of Object.values(children)) visit(asJsonSchema(child), currentDepth);
    }
    for (const key of ['items', 'additionalProperties', 'propertyNames', 'contains'] as const) {
      const child = schema[key];
      if (isJsonSchema(child)) visit(child, currentDepth);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const) {
      const children = schema[key];
      if (Array.isArray(children)) {
        for (const child of children) visit(asJsonSchema(child), currentDepth);
      }
    }
    for (const key of ['$defs', 'definitions'] as const) {
      const definitions = schema[key];
      if (isSchemaObject(definitions)) {
        for (const definition of Object.values(definitions)) {
          visit(asJsonSchema(definition), depth);
        }
      }
    }
  };

  visit(root, 0);
}

/** Rejects schemas that accept any value without an explicit validation keyword. */
function validateConstrainedNodes(root: Record<string, unknown>): void {
  const visited = new Set<Record<string, unknown>>();
  const visit = (schema: JsonSchema): void => {
    if (typeof schema === 'boolean') return;
    if (visited.has(schema)) return;
    visited.add(schema);
    if (!Object.keys(schema).some((key) => VALIDATION_KEYWORDS.has(key))) {
      throw new Error('Unconstrained tool input schema nodes are not supported');
    }
    for (const key of ['properties', 'patternProperties', '$defs', 'definitions'] as const) {
      const children = schema[key];
      if (isSchemaObject(children)) {
        for (const child of Object.values(children)) visit(asJsonSchema(child));
      }
    }
    for (const key of [
      'items',
      'additionalProperties',
      'propertyNames',
      'contains',
      'not',
      'if',
      'then',
      'else',
    ] as const) {
      const child = schema[key];
      if (isJsonSchema(child)) visit(child);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const) {
      const children = schema[key];
      if (Array.isArray(children)) {
        for (const child of children) visit(asJsonSchema(child));
      }
    }
  };
  visit(root);
}

function resolveLocalReference(root: Record<string, unknown>, reference: string): unknown {
  const path = reference
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let value: unknown = root;
  for (const segment of path) {
    if (!isSchemaObject(value) || !(segment in value)) {
      throw new Error(`Unresolved tool input schema reference: ${reference}`);
    }
    value = value[segment];
  }
  return value;
}

function validatePattern(pattern: string): void {
  if (pattern.length > MAX_SCHEMA_PATTERN_LENGTH || UNSAFE_NESTED_QUANTIFIER.test(pattern)) {
    throw new Error('Tool input schema contains a pattern that exceeds the safe complexity limit');
  }
  try {
    new RegExp(pattern);
  } catch {
    throw new Error('Tool input schema contains an invalid regular expression');
  }
}

function isObjectSchema(value: Record<string, unknown>): boolean {
  return (
    value.type === 'object' ||
    (Array.isArray(value.type) && value.type.includes('object')) ||
    'properties' in value
  );
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === 'boolean' || isSchemaObject(value);
}

function asJsonSchema(value: unknown): JsonSchema {
  if (!isJsonSchema(value)) throw new Error('Tool input schema contains a non-schema value');
  return value;
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
