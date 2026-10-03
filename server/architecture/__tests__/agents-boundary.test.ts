import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentsBoundaryViolation } from '../agents-boundary.js';
import { collectRoutingDependencies as collectServerDependencies } from '../routingBoundary.js';

describe('Agents application boundary', () => {
  it('resolves actual imports through the public index and Agent persistence', () => {
    const edges = collectServerDependencies(path.resolve(process.cwd()));
    expect(edges.some((edge) => edge.importer.startsWith('domains/agents/'))).toBe(true);
    expect(edges.filter((edge) => agentsBoundaryViolation(edge))).toEqual([]);
  });

  it.each([
    ['services/messageService.ts', 'domains/agents/agent-service.ts', false],
    ['services/toolOrchestration.ts', 'infrastructure/persistence/agent-repository.ts', false],
    ['domains/agents/agent-service.ts', 'services/api/mcpService.ts', false],
    ['domains/agents/agent-service.ts', 'domains/routing/routing-service.ts', true],
    ['domains/agents/agent-service.ts', 'unresolved:./missing.js', false],
    ['infrastructure/persistence/agent-repository.ts', 'domains/agents/index.ts', false],
  ])('rejects %s -> %s', (importer, target, typeOnly) => {
    expect(agentsBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it.each([
    ['domains/agents/agent-service.ts', 'infrastructure/persistence/agent-repository.ts', false],
    ['domains/agents/agent-service.ts', 'types.ts', true],
    ['endpoints/definitions/agents.ts', 'domains/agents/index.ts', false],
    ['infrastructure/persistence/agent-repository.ts', 'domains/agents/index.ts', true],
  ])('allows %s -> %s', (importer, target, typeOnly) => {
    expect(agentsBoundaryViolation({ importer, target, typeOnly })).toBeNull();
  });
});
