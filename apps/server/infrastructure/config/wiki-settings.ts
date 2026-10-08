import * as settingsService from '../../application/settings/settings-service.js';

/** Read the existing configured Wiki root without coupling domain rules to global settings. */
export function getConfiguredWikiPath(): string | undefined {
  return settingsService.get().wikiPath;
}
