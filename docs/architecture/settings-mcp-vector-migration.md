# Settings, MCP and Vector Migration Evidence

## Scope

This batch moves the remaining Settings persistence, MCP server persistence and connection manager, model/vector connection checks, and Wiki vector storage adapters into the Server infrastructure layer. Existing HTTP, Electron, database, MCP and vector behavior remains behind the existing application facades.

## File mapping

| Previous location | New location | Responsibility |
| --- | --- | --- |
| `server/repositories/settingsRepository.ts` | `server/infrastructure/config/settings-repository.ts` | Settings key/value persistence |
| `server/repositories/mcpServerRepository.ts` | `server/infrastructure/persistence/mcp-server-repository.ts` | MCP server configuration persistence |
| `server/services/api/mcpService.ts` | `server/infrastructure/mcp/mcp-client-manager.ts` | Process-scoped MCP transport and tool lifecycle |
| — | `server/bootstrap/mcp-client.ts` | Process-scoped MCP manager composition |
| `server/services/api/mcp-server-service.ts` | `server/application/mcp/mcp-server-service.ts` | MCP CRUD and connection application facade |
| `server/services/api/modelConnectionService.ts` | `server/infrastructure/ai/model-connection-verification.ts` plus `server/bootstrap/model-connections.ts` | Provider-backed model verification and adapter composition |
| `server/services/api/vectorConnectionService.ts` | `server/infrastructure/search/vector-connection-verification.ts` | Embedding and Chroma connection checks |
| `server/repositories/vectorRepository.ts` | `server/infrastructure/persistence/vector-repository.ts` | SQLite vector persistence |
| `server/repositories/chromaVectorRepository.ts` | `server/infrastructure/search/chroma-vector-store.ts` | Experimental Chroma vector-store adapter |
| `server/repositories/wikiVectorBackfillRepository.ts` | `server/infrastructure/persistence/wiki-vector-backfill-repository.ts` | Durable Wiki vector backfill state |

Settings CRUD, connection API descriptors and Wiki vector orchestration keep their existing public facades. Startup, tools and Electron use the bootstrap MCP instance; MCP endpoint descriptors call the application facade. No API names, table schemas, or transport payloads were intentionally changed.

## Dependency and compatibility checks

- Pre-edit impact assessments were recorded in the migration work: Settings repository and MCP service were MEDIUM; model/vector connection services were LOW; vector repository and Settings service were UNKNOWN. UNKNOWN results were treated as unresolved and corroborated with source reference scans before moving files.
- Static imports and literal dynamic imports were searched after relocation. The memory process smoke import and synthetic architecture cases were updated to the new Settings adapter path; obsolete known-violation entries were removed after MCP and Settings coupling disappeared.
- `server/architecture/__tests__/agents-boundary.test.ts` protects the rule that Agent domain code does not depend on the concrete MCP infrastructure manager.
- TypeScript source filenames added or moved in this batch use kebab-case. Legacy files outside the migrated paths were not renamed as part of this batch.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck -w mint-server` | PASS |
| `npm exec --workspace=mint-server -- vitest run ...` (focused persistence, connection, Settings, MCP and architecture suites) | PASS, 16 files / 133 tests |
| Prettier on changed Server TypeScript/configuration files | PASS |
| Architecture boundary tests | PASS (included in focused run) |
| `git diff --check` | PASS |
| Temporary-index rename probe | PASS at `-M20%`; seven prior paths are recognized as renames |

The migration remains uncommitted, so post-commit `git log --follow` cannot yet be verified. The MCP server repository is a 28% similarity match and therefore needs `git log --follow --find-renames=20%` to walk through its move; the prior commits remain in Git. Other recognized source moves are at least 65%. This evidence does not claim end-to-end live MCP, provider or Chroma connectivity.
