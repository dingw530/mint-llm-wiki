/** Existing synchronous Wiki file operations, isolated from application policy. */
export { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
/** Transitional parser/schema adapter shared with the unmigrated compiler/search modules. */
export { normalizeWikiSchema, parseWikiPage } from '../../services/utils/wikiShared.js';
