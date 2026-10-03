import * as settingsService from '../../services/api/settingsService.js';

/** Read the existing configured Wiki root without coupling domain rules to global settings. */
export function getConfiguredWikiPath(): string | undefined {
  return settingsService.get().wikiPath;
}
