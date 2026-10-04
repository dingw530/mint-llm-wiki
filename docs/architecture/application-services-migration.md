# Application Services Migration Evidence

## Scope

Move the remaining TypeScript modules out of `server/services/api/` according to responsibility while keeping exported operations, HTTP/IPC descriptors, startup/shutdown behavior and settings formats stable. The new `server/application/` layer holds HTTP-agnostic cross-domain use cases. The endpoint-level Jev probe is an infrastructure AI capability. Redundant model/vector connection re-export modules were removed because callers already use `bootstrap/model-connections.ts` or the infrastructure verifier.

## File mapping

| Previous location | New location | Responsibility |
| --- | --- | --- |
| `server/services/api/settingsService.ts` | `server/application/settings/settings-service.ts` | Legacy settings use case and read/write facade |
| `server/services/api/mcp-server-service.ts` | `server/application/mcp/mcp-server-service.ts` | MCP server configuration use case |
| `server/services/api/memorySpaceService.ts` | `server/application/memory/memory-space-service.ts` | Memory-space management and binding coordination |
| `server/services/api/conversationScopeLock.ts` | `server/application/conversations/conversation-scope-lock.ts` | In-process reservation for memory-scope changes |
| `server/services/api/approval-message-persistence.ts` | `server/application/agent-runtime/approval-message-persistence.ts` | Persist assistant continuation after tool approval |
| `server/services/api/toolApprovalService.ts` | `server/application/agent-runtime/tool-approval-service.ts` | Consume approval, resume the existing run and adapt stream output |
| `server/services/api/wikiIngestionJobService.ts` | `server/application/wiki/wiki-ingestion-job-service.ts` | Compose the Wiki domain worker with existing app/runtime capabilities |
| `server/services/api/wikiVectorBackfillService.ts` | `server/application/wiki/wiki-vector-backfill-service.ts` | Start and coordinate durable Wiki vector backfill jobs |
| `server/services/api/jevConnectionService.ts` | `server/infrastructure/ai/jev-connection-verification.ts` | Bounded provider connection probe |
| `server/services/api/modelConnectionService.ts` | Removed | Redundant re-export of `bootstrap/model-connections.ts` |
| `server/services/api/vectorConnectionService.ts` | Removed | Redundant re-export of `infrastructure/search/vector-connection-verification.ts` |

The six colocated API tests moved beside their application or infrastructure modules and use kebab-case filenames. Endpoint, route, CLI, runtime and Electron consumers now reference the new locations. Existing model/vector endpoint names and Wiki job IPC method names were not changed.

## Impact review

GitNexus was refreshed before the move. Selected upstream impacts:

| Target | Result | Review |
| --- | --- | --- |
| `settingsService.getAiSettings` | CRITICAL; 13 direct dependencies, 14 affected processes; one unresolved receiver and truncated process sampling | Changed only module location and import literals; existing settings tests and consumer path scan cover the fan-out |
| `reserveConversationScope` | HIGH; 2 direct dependencies and 3 affected processes | Kept reservation and release behavior byte-for-byte |
| `persistApprovalContinuation` | HIGH; 3 direct dependencies and 3 affected processes | Kept call sites and persistence condition unchanged |
| `wikiVectorBackfillService.getStatus` | MEDIUM; 9 direct dependencies and 16 impacted symbols | Preserved the same status/export API |
| `testJevConnection` | LOW; one endpoint dependency | Endpoint descriptor still calls the same probe |
| Memory/MCP/approval/Wiki job entry symbols | UNKNOWN on some results | Cross-checked resolved imports, dynamic imports and endpoint namespace property reads before updating paths |

Risk applies to the whole workspace graph, which already contains unrelated uncommitted migrations. No behavior was intentionally changed in this batch.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck -w mint-server` | PASS |
| Focused Settings/Memory/approval/Wiki/Jev and architecture Vitest suites | PASS, 19 files / 138 tests |
| Prettier on changed Server TypeScript/configuration files | PASS |
| Legacy `services/api` import scan | PASS; no production import or dynamic import remains |
| `git diff --check` | PASS |
| Temporary-index rename/history probe | PASS at 50%; all source/test moves with committed origins are detected as renames |

Two existing Settings dependencies from `infrastructure/ai/llm-routing-classifier.ts` and `infrastructure/config/wiki-settings.ts` remain transitional bridges; this move does not add new ones. A temporary Git index confirms the committed-origin source and test moves are detectable renames at the normal 50% threshold; the new MCP application facade has no prior committed path. The migration is uncommitted and makes no live-provider or real MCP connectivity claim.
