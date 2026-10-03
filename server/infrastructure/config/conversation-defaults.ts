import * as settingsRepository from '../../repositories/settingsRepository.js';

/**
 * Read the persisted route preference without importing settings storage into the domain.
 * @returns Configured route mode, or undefined when the preference has not been set
 */
export function getConversationRoutingMode(): string | undefined {
  return settingsRepository.getAll().routingMode;
}
