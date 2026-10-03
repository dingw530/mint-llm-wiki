import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conversationsBoundaryViolation } from '../conversations-boundary.js';
import { collectRoutingDependencies as collectServerDependencies } from '../routingBoundary.js';

describe('Conversations application boundary', () => {
  it('resolves runtime consumers through the public index', () => {
    const edges = collectServerDependencies(path.resolve(process.cwd()));
    expect(edges.some((edge) => edge.importer.startsWith('domains/conversations/'))).toBe(true);
    expect(edges.filter((edge) => conversationsBoundaryViolation(edge))).toEqual([]);
  });

  it.each([
    ['services/messageService.ts', 'infrastructure/persistence/conversation-repository.ts', false],
    ['domains/conversations/conversation-service.ts', 'repositories/settingsRepository.ts', false],
    ['domains/conversations/conversation-service.ts', 'services/agentRun.ts', false],
    [
      'endpoints/definitions/conversations.ts',
      'domains/conversations/conversation-service.ts',
      false,
    ],
    ['infrastructure/config/conversation-defaults.ts', 'domains/conversations/index.ts', false],
  ])('rejects %s -> %s', (importer, target, typeOnly) => {
    expect(conversationsBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });
});
