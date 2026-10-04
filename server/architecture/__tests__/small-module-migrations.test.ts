import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectRoutingDependencies } from '../routingBoundary.js';
import { toolSecurityBoundaryViolation } from '../tool-security-boundary.js';
import { ingestionTransportBoundaryViolation } from '../ingestion-transport-boundary.js';

describe('Small module migration boundaries', () => {
  it('checks actual production imports and literal dynamic entry points', () => {
    const edges = collectRoutingDependencies(path.resolve(process.cwd()));
    expect(edges.some((edge) => edge.importer.startsWith('domains/tool-security/'))).toBe(true);
    expect(edges.some((edge) => edge.importer === 'http/streams/ingestion-events.ts')).toBe(true);
    expect(edges.filter((edge) => toolSecurityBoundaryViolation(edge))).toEqual([]);
    expect(edges.filter((edge) => ingestionTransportBoundaryViolation(edge))).toEqual([]);
  });

  it.each([
    ['services/tools/BashTool.ts', 'domains/tool-security/bash-security-service.ts', false],
    ['services/tools/BashTool.ts', 'infrastructure/config/bash-security-settings.ts', false],
    [
      'domains/tool-security/bash-security-service.ts',
      'infrastructure/config/settings-repository.ts',
      false,
    ],
    ['infrastructure/config/bash-security-settings.ts', 'domains/tool-security/index.ts', false],
  ])('rejects a Tool security dependency %s -> %s', (importer, target, typeOnly) => {
    expect(toolSecurityBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it.each([
    [
      'domains/tool-security/bash-security-service.ts',
      'infrastructure/config/bash-security-settings.ts',
      false,
    ],
    ['services/tools/BashTool.ts', 'domains/tool-security/index.ts', false],
    ['infrastructure/config/bash-security-settings.ts', 'domains/tool-security/index.ts', true],
  ])('allows a Tool security dependency %s -> %s', (importer, target, typeOnly) => {
    expect(toolSecurityBoundaryViolation({ importer, target, typeOnly })).toBeNull();
  });

  it.each([
    ['infrastructure/transports/ingestion-a2ui.ts', 'domains/wiki/index.ts', false],
    ['http/streams/ingestion-events.ts', 'repositories/messageRepository.ts', false],
    ['domains/wiki/wiki-ingestion-service.ts', 'http/streams/ingestion-events.ts', false],
    ['agent-runtime/react-loop-core.ts', 'infrastructure/transports/ingestion-a2ui.ts', false],
  ])('rejects an ingestion transport dependency %s -> %s', (importer, target, typeOnly) => {
    expect(ingestionTransportBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it.each([
    ['infrastructure/transports/ingestion-a2ui.ts', 'domains/wiki/index.ts', true],
    ['http/streams/ingestion-events.ts', 'application/wiki/wiki-ingestion-job-service.ts', false],
    ['http/streams/ingestion-events.ts', 'infrastructure/transports/ingestion-a2ui.ts', false],
    ['endpoints/definitions/conversations.ts', 'http/streams/ingestion-events.ts', false],
  ])('allows an ingestion transport dependency %s -> %s', (importer, target, typeOnly) => {
    expect(ingestionTransportBoundaryViolation({ importer, target, typeOnly })).toBeNull();
  });
});
