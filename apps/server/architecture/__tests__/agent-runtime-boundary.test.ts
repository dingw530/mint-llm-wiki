import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectRoutingDependencies, type RoutingDependency } from '../routingBoundary.js';
import { agentRuntimeBoundaryViolation } from '../agent-runtime-boundary.js';

describe('Agent Runtime boundaries', () => {
  it('allows the current core import graph and type-only contracts', () => {
    const serverRoot = path.resolve(process.cwd());
    const edges = collectRoutingDependencies(serverRoot);
    expect(edges.filter((edge) => agentRuntimeBoundaryViolation(edge))).toEqual([]);
  });

  it.each([
    ['agent-runtime/react-loop-core.ts', 'application/settings/settings-service.ts', false, true],
    ['agent-runtime/react-loop-core.ts', 'infrastructure/tools/bash-tool.ts', false, true],
    [
      'agent-runtime/react-loop-core.ts',
      'infrastructure/persistence/agent-run-event-repository.ts',
      false,
      true,
    ],
    ['agent-runtime/react-loop-core.ts', 'agent-runtime/tooling/runtime-context.ts', true, false],
    ['agent-runtime/contracts.ts', 'application/agent-runtime/tool-round-engine.ts', true, false],
    ['agent-runtime/react-loop-core.ts', 'agent-runtime/context-window.ts', true, false],
  ])('checks %s -> %s', (importer, target, typeOnly, expectedViolation) => {
    const edge: RoutingDependency = { importer, target, typeOnly };
    expect(Boolean(agentRuntimeBoundaryViolation(edge))).toBe(expectedViolation);
  });
});
