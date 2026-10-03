import {
  RoutingService as DomainRoutingService,
  formatRoutingLogMethod,
} from '../domains/routing/index.js';
import type { RoutingHooks, RoutingStepFactory } from '../domains/routing/index.js';
import * as routingLogRepository from '../infrastructure/persistence/routing-log-repository.js';
import { recordRoute } from '../infrastructure/persistence/routing-log-writer.js';
import * as settingsService from '../services/api/settingsService.js';
import { DISABLED_JEV_SETTINGS } from '../services/jev/config.js';

import { classify, createDefaultRoutingSteps, LEGACY_ROUTING_STEPS } from './routingSteps.js';

/** Compose the existing RoutingService constructor API with explicit runtime ports. */
export class RoutingService extends DomainRoutingService {
  /** Bind configuration, model and persistence ports for the existing constructor API. */
  constructor(hooks?: Partial<RoutingHooks>, stepFactory?: RoutingStepFactory) {
    super(
      {
        getJevSettings: settingsService.getJevSettings,
        classify,
        createDefaultSteps: (jev) => createDefaultRoutingSteps(jev),
        legacySteps: LEGACY_ROUTING_STEPS,
        disabledJevSettings: DISABLED_JEV_SETTINGS,
        recordRoute: (result, context) =>
          recordRoute(result, context, formatRoutingLogMethod(result.attempts, result.method)),
      },
      hooks,
      stepFactory,
    );
  }
}

export const routingService = new RoutingService();

/** Read routing audit logs through the composition root, preserving endpoint pagination. */
export function listRoutingLogs(
  filter: routingLogRepository.RoutingLogFilter = {},
): routingLogRepository.RoutingLogResult[] {
  return routingLogRepository.findAll(filter);
}
