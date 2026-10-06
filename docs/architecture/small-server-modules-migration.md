# Small Server modules migration

Date: 2026-10-04. Scope: move three small Server responsibilities behind the current domain, infrastructure and HTTP boundaries without changing HTTP/SSE/IPC payloads, stored settings, command policy or Agent Runtime behavior.

## Selected modules and path map

| Responsibility                           | Before                                           | After                                             |
| ---------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Conversation slash-command normalization | `services/api/slashCommandService.ts`            | `domains/conversations/slash-command.ts`          |
| Bash security policy                     | `services/api/bashSecurityService.ts`            | `domains/tool-security/bash-security-service.ts`  |
| Bash security settings adapter           | Direct `settingsRepository` calls in the service | `infrastructure/config/bash-security-settings.ts` |
| Ingestion task A2UI projection           | `services/api/ingestionA2ui.ts`                  | `infrastructure/transports/ingestion-a2ui.ts`     |
| Conversation ingestion SSE stream        | `services/api/ingestionEventsService.ts`         | `http/streams/ingestion-events.ts`                |

The domain and adapter files use kebab-case. The stream retains the existing Wiki ingestion application façade as a documented transition bridge; transport delivery does not move into the Wiki domain.

## Impact and behavior constraints

GitNexus 1.6.12 was refreshed against HEAD `41615ff` before these changes. File impact was LOW for slash commands, Bash security, and ingestion events; `checkCommand` and `toIngestionTaskCardModel` exact-symbol impact were LOW. The A2UI file-level target was ambiguous, so the exact projection symbol and static import sites were inspected. The incremental analyzer initially returned an implausible process mapping for the new boundary function; a forced full rebuild confirmed that function has no incoming production calls. GitNexus still reports broad flow sampling truncation, so the resolved TypeScript dependency inventory and source call sites were checked as well.

Bash security keeps its regular expressions, configured substring checks, block reasons and return values. The settings adapter keeps the existing JSON string keys and read/write format. Slash-command validation keeps the registered command set and context wording. Ingestion keeps the `: connected` and heartbeat comments, A2UI v0.9 envelope order, chat/conversation filtering and unsubscribe-on-close behavior. Electron namespace member names and HTTP routes remain unchanged.

## Verification

- Server typecheck passed.
- Existing paths were searched across Server and Electron; no references to the old module filenames remain.
- Prettier and `git diff --check` passed for the moved and changed files.
- A temporary Git index/object-directory probe recognized all six moved source/test files using default rename detection and recovered every prior commit from each original source path; missing commit count was zero. The probe left HEAD and the real index unchanged.
- Source history was checked for all seven moved source/test files using a temporary index/object store and default rename detection. Similarity ranged from 74% to 100%; prior commit counts were recovered with zero missing commits. Real HEAD and index hashes stayed unchanged.
- Vitest was not run in this turn. The attempted elevated focused-suite command was rejected by automatic review because the account reached its usage limit before command execution. Focused suites, lint, bundle smoke and normal commits remain for a verification follow-up.

The work is uncommitted. Existing changes to the model endpoint migration, Codex plugin/MCP content, eval version reports and other user files remain in the worktree and were preserved.
