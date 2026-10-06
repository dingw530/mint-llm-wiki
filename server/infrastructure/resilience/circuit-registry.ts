import type { CircuitSnapshot } from './types.js';

type Internal = CircuitSnapshot;
const registry = new Map<string, Internal>();

function fresh(): Internal {
  return { state: 'closed', failures: 0, openedAt: null, probeInFlight: false };
}

export function getCircuit(key: string): Internal {
  return registry.get(key) ?? fresh();
}
export function snapshotCircuit(key: string): CircuitSnapshot {
  return { ...getCircuit(key) };
}
export function markFailure(key: string, threshold: number, now = Date.now()): void {
  const current = getCircuit(key);
  current.failures += 1;
  if (current.failures >= threshold) {
    current.state = 'open';
    current.openedAt = now;
    current.probeInFlight = false;
  }
  registry.set(key, current);
}
export function markSuccess(key: string): void {
  registry.set(key, fresh());
}
export function allowCall(key: string, cooldownMs: number, now = Date.now()): boolean {
  const current = getCircuit(key);
  if (current.state === 'closed') return true;
  if (
    current.state === 'open' &&
    current.openedAt !== null &&
    now - current.openedAt >= cooldownMs
  ) {
    if (current.probeInFlight) return false;
    current.state = 'half-open';
    current.probeInFlight = true;
    registry.set(key, current);
    return true;
  }
  return false;
}
export function releaseProbe(key: string): void {
  const current = getCircuit(key);
  current.probeInFlight = false;
  registry.set(key, current);
}
export function clearCircuits(): void {
  registry.clear();
}
