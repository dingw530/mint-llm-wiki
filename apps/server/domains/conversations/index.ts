/** Public API for persisted conversation configuration and lifecycle management. */
export {
  list,
  create,
  findById,
  removeAll,
  remove,
  rename,
  setLockedAgent,
} from './conversation-service.js';

export { buildSlashCommandContext, validateSlashCommand } from './slash-command.js';
export type { SlashCommandIntent } from './slash-command.js';
