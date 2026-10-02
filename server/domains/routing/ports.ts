import type { Agent, JevSettings } from '../../types.js';
import type { RouteResult, RoutingContext, RoutingStepFactory } from './routingService.js';
import type { RoutingStep } from './types.js';

/** Classify candidates with an external model, returning null when unavailable. */
export type RoutingClassifier = (
  message: string,
  candidates: readonly Agent[],
) => Promise<{ agentId: string; confidence: number } | null>;

/** Runtime capabilities injected by the Routing composition root. */
export interface RoutingDependencies {
  getJevSettings(): JevSettings;
  classify: RoutingClassifier;
  createDefaultSteps: RoutingStepFactory;
  legacySteps: readonly RoutingStep[];
  disabledJevSettings: JevSettings;
  recordRoute(result: RouteResult, context: RoutingContext): void;
}
