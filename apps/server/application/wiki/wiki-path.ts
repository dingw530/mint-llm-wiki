import * as settingsService from '../settings/settings-service.js';

/** Returns the configured Wiki root, or null when no Wiki is configured. */
export function getWikiPath(): string | null {
  return settingsService.getAiSettings().wikiPath || null;
}
