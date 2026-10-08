import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { extractArgs } from '../helpers.js';

describe('extractArgs', () => {
  it('passes the entire query object when a query mapping has no name', () => {
    const query = { scopeKind: 'unassigned', includeInactive: 'true' };
    const request = { query } as Request;

    expect(extractArgs(request, [{ from: 'query' }])).toEqual([query]);
  });

  it('keeps named query mappings scoped to their requested field', () => {
    const request = { query: { category: 'preference', scopeKind: 'global' } } as Request;

    expect(extractArgs(request, [{ from: 'query', name: 'category' }])).toEqual(['preference']);
  });
});
