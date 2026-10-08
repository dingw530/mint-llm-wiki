import * as settingsRepository from './settings-repository.js';

interface StoredBashSecuritySettings {
  bashBlockedCommands?: string;
  bashBlockedDirs?: string;
}

/**
 * Read only the persisted settings owned by Bash command security.
 * @returns Raw list encodings interpreted by the domain policy
 */
export function readBashSecuritySettings(): StoredBashSecuritySettings {
  const raw = settingsRepository.getAll();
  return {
    bashBlockedCommands: raw.bashBlockedCommands,
    bashBlockedDirs: raw.bashBlockedDirs,
  };
}

/**
 * Persist the existing Bash security keys without changing their storage format.
 * @param settings JSON-encoded blocked command and directory lists
 */
export function writeBashSecuritySettings(settings: Required<StoredBashSecuritySettings>): void {
  settingsRepository.upsertAll({
    bashBlockedCommands: settings.bashBlockedCommands,
    bashBlockedDirs: settings.bashBlockedDirs,
  });
}
