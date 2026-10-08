# Architecture Layers

Mint is a TypeScript monorepo with three independent packages. Each package has its own internal layer hierarchy. Cross-package imports follow strict rules.

## Package Structure

```
apps/client/          React SPA — UI layer
apps/server/          Express API — backend layer
apps/electron/        Desktop shell — wrapper layer
shared/          (reserved) — future shared types/utils
```

## Dependency Direction

```
electron → client → server
         ↓
      (no reverse)
```

**electron** may import from **client** (built assets) and **server** (Node.js modules).
**client** may NOT import from **server** (they communicate via HTTP/SSE only).
**server** may NOT import from **client**.
**shared** (when added) may be imported by both client and server.

## Server Layer Hierarchy

```
types             Pure definitions
agent-runtime     Runtime contracts and ReAct execution
domains           Business rules and domain APIs
application       Cross-domain use cases and adapters
infrastructure    External systems and technical adapters
bootstrap         Process-scoped composition and lifecycle
http/endpoints    Transport adapters
```

**Rule:** Runtime and domain code depend on owned contracts; application coordinates public domain/runtime APIs; infrastructure implements technical capabilities; bootstrap composes concrete dependencies. HTTP, CLI and Electron entry points call application/runtime APIs. Do not add new implementation modules under `apps/server/services/`.

### Application services (incremental migration)

`apps/server/application/` contains HTTP-agnostic use cases that coordinate domain APIs, Agent Runtime, persistence/configuration capabilities and external adapters. Endpoint, route, CLI and Electron entry points call these use cases; application modules do not own Express handlers or transport protocols. Application TypeScript files use kebab-case filenames. The former `apps/server/services/` implementation modules have moved to their runtime, domain, application or infrastructure owners.

[Server services migration evidence](server-services-migration.md) records the move map and verification boundary.

`bootstrap/` continues to own process-scoped composition and resource lifecycle. Two inherited Settings reads from infrastructure still use the Settings application facade; this remains explicit migration debt and is not authorization for new infrastructure-to-application imports.

Provider protocol implementations and the API adapter registry live in `infrastructure/ai/adapters/`. They translate model/provider requests and streams; Agent Runtime, ToolLoop execution, approvals, and public SSE event semantics remain Mint-owned. Built-in adapters are registered at the Agent Runtime bootstrap boundary. [AI adapters and A2UI migration evidence](ai-adapters-a2ui-migration.md) records the moved files and checks.

### Memory domain boundary (incremental migration)

The existing top-level Server layer diagram describes the current broad layout. Memory migration adds a finer boundary without implying that the other Server domains have moved:

```text
apps/server/
  domains/memory/                 # memory policy and use cases
  infrastructure/persistence/   # memory SQLite repositories and FTS projection
  infrastructure/ai/            # memory extraction and gate adapters
  bootstrap/memory.ts             # explicit service/lifecycle composition
  application/conversations/context/ # request-context assembly and providers
```

Memory domain implementation imports only its own domain modules, `infrastructure/`, explicit type-only `apps/server/types.ts` contracts, and the shared pure token estimator. Memory-specific persistence and AI adapters are composed by `bootstrap/memory.ts`; application entry points do not import those implementations directly. Infrastructure may import Memory type contracts, never Memory runtime services. Other consumers use `domains/memory/index.ts`; tests may import internal modules for focused unit coverage. Literal dynamic imports and re-exports are checked with the same rule.

`apps/server/architecture/__tests__/memoryBoundary.test.ts` tests the policy, and `memoryBoundary.ts` resolves actual TypeScript dependencies so physical paths and deep relative imports are checked. The broader Server proposal now also relocates the former `services/` modules into their owning runtime, application and infrastructure layers.

### Routing domain boundary (incremental migration)

```text
apps/server/
  domains/routing/                # Agent choice rules, fallback policy, hooks and runtime ports
  infrastructure/ai/            # Jev routing provider and LLM classifier
  infrastructure/persistence/   # routing_logs repository and writer
  bootstrap/routing.ts           # RoutingService and audit-query composition
  bootstrap/routingSteps.ts      # configured provider order and adapter instances
```

Routing chooses an Agent; HTTP routing remains in the existing endpoints/routes layout.
The domain imports only its own modules, type-only `apps/server/types.ts`, and the shared logger/error helpers. Configuration, model classification and audit writes are injected through `RoutingDependencies`. Infrastructure imports Routing type contracts through the public index; bootstrap supplies the fallback Agent id and audit method formatting. Outside domain consumers use the public index for domain APIs or `bootstrap/routing.ts` for the configured service and log queries.

`apps/server/architecture/routingBoundary.ts` resolves static imports, re-exports and literal dynamic imports with TypeScript. Its tests reject domain dependencies on settings/models/persistence, deep consumer imports, runtime domain imports from Routing infrastructure, and direct infrastructure access outside bootstrap. Focused tests may access internal modules. The file mapping, history checks and verification limits are recorded in [Routing migration evidence](routing-domain-migration.md).

### Agents configuration boundary (incremental migration)

```text
apps/server/
  domains/agents/                 # Agent CRUD and orchestrator prompt policy
  infrastructure/persistence/
    agent-repository.ts           # existing SQLite Agent storage
```

Agents owns configuration and management only; AgentRun, ReAct execution, tool approval and MCP connection management remain in their existing modules. Consumers use `domains/agents/index.ts`, including HTTP descriptors, message/tool orchestration, evaluation and the Electron namespace export.

Following the incremental Memory boundary, this small application service may access its own infrastructure repository directly; it does not need a new bootstrap lifecycle or dependency-injection factory. Other production modules may not import Agent persistence directly. The domain imports only its own modules, Agent persistence and type-only Server contracts. Infrastructure may consume public domain type contracts, never runtime services.

`apps/server/architecture/agents-boundary.ts` enforces this policy using the existing resolved Server dependency inventory. Focused tests may import internal modules. Migration evidence and scope limitations are recorded in [Agents migration evidence](agents-domain-migration.md).

### Conversations management boundary (incremental migration)

```text
apps/server/
  domains/conversations/          # conversation CRUD, route defaults and Agent locking
  infrastructure/persistence/
    conversation-repository.ts   # existing SQLite conversation storage
  infrastructure/config/
    conversation-defaults.ts     # settings-storage adapter for the route preference
```

HTTP, CLI, Electron and message setup use `domains/conversations/index.ts`. The domain owns persisted conversation management and nullable metadata lookup, and may import only its own modules, its conversation repository/defaults adapter, type-only Server contracts and external packages such as UUID. Other production Server modules may not access this infrastructure directly. Test fixtures may use the repository to preserve explicit fixture ids.

Message streaming and AgentRun remain in their current locations. Request-time conversation reservations are now in `application/conversations/conversation-scope-lock.ts`; Memory space management is in `application/memory/memory-space-service.ts`. This migration does not claim completion of all message/runtime responsibilities.

`apps/server/architecture/conversations-boundary.ts` checks actual resolved imports, including literal dynamic imports. [Conversations migration evidence](conversations-domain-migration.md) records the scope and validation.

Conversation slash-command metadata is normalized by `domains/conversations/slash-command.ts`, exported through the existing public index and used by both HTTP and Electron chat paths. It only creates constrained task context; actual tool selection, policy and approval still go through the existing Agent Runtime.

### Skills, knowledge graph and Wiki management boundaries

```text
apps/server/
  domains/skills/                 # frontmatter, lookup and cache policy
  domains/knowledge-graph/        # graph CRUD and candidate review transactions
  domains/wiki/                   # file/schema management, retention and knowledge lifecycle
  infrastructure/filesystem/     # Skills directory and Wiki file operations
  infrastructure/config/         # Wiki root settings adapter
  infrastructure/persistence/    # graph/candidate and Wiki lifecycle repositories
  infrastructure/jobs/           # durable Wiki ingestion queue/store/event adapters
  bootstrap/wiki-lifecycle.ts    # explicitly started, unref-ed lifecycle timer
```

Consumers use each domain's public `index.ts`. Domain rules access only their own infrastructure and approved shared contracts; the shared logger and graph ontology remain pure utility dependencies. Wiki owns source ingestion, compilation, commit recovery, and the background job state machine. Knowledge Graph owns cross-batch candidate generation. Staged source-file operations, ingestion commit records, and durable job queue/store/event adapters live under `infrastructure/`. `application/wiki/wiki-ingestion-job-service.ts` composes the domain worker with existing HTTP/Electron dependencies, and `application/wiki/wiki-vector-backfill-service.ts` owns the vector backfill use case. The Wiki compiler still uses shared Wiki page-writing helpers and the existing API adapter; cross-batch generation still reads Wiki source files directly and uses that API adapter. These are explicit migration bridges recorded in `knowledge-domains-boundary.ts` where applicable.

The low-frequency lifecycle timer is composed by bootstrap and remains owned/drained by ServerRuntime. Importing the Wiki domain does not start a timer.

`knowledge-domains-boundary.ts` resolves imports, re-exports and literal dynamic dependencies using the existing Server dependency inventory. The graph generation/cross-batch matching flows, backfill worker and WikiSearchTool now use public domain APIs instead of direct graph/lifecycle/search repository imports. Other production modules must use public APIs, and infrastructure may import only domain type contracts.

[Three-domain migration evidence](skills-graph-wiki-migration.md) records scope, compatibility, tests and history-preserving commit preparation. That initial migration checkpoint excluded Wiki search, ingestion, compiler and cross-batch generation; later Wiki search and ingestion migrations are recorded separately below and in the evidence file.

### Wiki search application boundary

`domains/wiki/wiki-search-service.ts` owns index orchestration, lexical/vector candidate fusion, page aggregation, evidence/snippet construction, source-family expansion and access feedback. Its public functions are exported through the existing Wiki index. Search state uses only the per-run `getJevSettings` capability instead of importing Agent runtime types.

`infrastructure/persistence/wiki-search-repository.ts` retains SQLite/FTS transactions. Wiki rerank policy and providers live in `domains/wiki/rerank/`; the Jev provider keeps its explicit dependency on the shared apps/client/config utilities in `infrastructure/ai/jev/`. That package owns the external protocol, request/retry handling, shared questions and wire types; routing and memory providers remain composed in `infrastructure/ai/`.

`infrastructure/search/vector/` owns the embedding provider, vector ports/types and idempotent sync/backfill service. `infrastructure/search/wiki-vector-service.ts` composes the Wiki repository and optional Chroma adapter. Resilience policies live in `infrastructure/resilience/` and are shared by vector adapters and the Wiki search runtime. SQLite/sqlite-vec remains the default store. Wiki file primitives live in their filesystem adapter. The ingestion pipeline, evaluation, tools and MCP search entry use the public Wiki API.

The independent vector backfill job now lives in `application/wiki/wiki-vector-backfill-service.ts` and reaches Wiki persistence through the public API. WikiSearchTool remains in its legacy tool location; Wiki rerank types use the Wiki search storage contract as a type-only import. Ingestion consumers and job status contracts use the Wiki public API. [Wiki search migration evidence](wiki-search-domain-migration.md) records unchanged behavior and verification limits.

### Model endpoint management boundary

```text
apps/server/
  domains/model-endpoints/                         # CRUD, activation, key handling and verification state
  infrastructure/persistence/model-endpoint-repository.ts # existing model_endpoints SQLite storage
```

HTTP descriptors, settings and the Electron namespace export use `domains/model-endpoints/index.ts`. The domain may import only its own modules, its persistence implementation, type-only Server contracts and the existing pure encryption helper. Other production modules may not access model endpoint persistence directly. Test fixtures may use the repository.

`syncLegacyEndpointSettings` keeps the settings form's existing partial writes, accepts its already encrypted key and preserves verification state. It does not substitute the CRUD update path, whose validation and verification invalidation are different. Provider/model networking is verified by `infrastructure/ai/model-connection-verification.ts` and composed with the adapter registry in `bootstrap/model-connections.ts`. Settings storage, HTTP descriptor registration and API/IPC names retain their existing layout and behavior.

`model-endpoints-boundary.ts` checks resolved imports, re-exports and literal dynamic imports. [Model endpoint migration evidence](model-endpoints-domain-migration.md) records scope, risk, tests and history checks.

### Tool security policy boundary

`domains/tool-security/` owns Bash command blocking rules and typed configuration policy. Its `infrastructure/config/bash-security-settings.ts` adapter reads and writes only the existing `bashBlockedCommands` and `bashBlockedDirs` settings keys. HTTP configuration, Electron exports and Bash execution use the domain public index; they do not access settings storage directly. Command matching, built-in block patterns and approval flow are unchanged.

`apps/server/architecture/tool-security-boundary.ts` enforces the public entry and persistence ownership.

### Settings, MCP and vector infrastructure migration

Settings key/value persistence is under `infrastructure/config/settings-repository.ts`; the Settings use case is in `application/settings/settings-service.ts`, with endpoint and Electron contracts preserved. MCP server persistence and process-scoped connection lifecycle live in `infrastructure/persistence/mcp-server-repository.ts` and `infrastructure/mcp/mcp-client-manager.ts`. `bootstrap/mcp-client.ts` owns the manager instance, and `application/mcp/mcp-server-service.ts` keeps MCP configuration CRUD and connection coordination behind the endpoint descriptor.

Model and vector connection verification are infrastructure capabilities composed from the existing adapter/settings dependencies. SQLite vector persistence and the experimental Chroma store live in `infrastructure/persistence/vector-repository.ts` and `infrastructure/search/chroma-vector-store.ts`; provider/service contracts live in `infrastructure/search/vector/`, and Wiki composition remains behind its Wiki/application adapters. [Settings, MCP and vector migration evidence](settings-mcp-vector-migration.md) records moved files, callers and verification limits.

### Remaining API application modules

Approval continuation and its message-persistence adapter now live in `application/agent-runtime/`; conversation scope reservations and memory-space use cases live in `application/conversations/` and `application/memory/`. The shared Jev client moved to `infrastructure/ai/jev/` alongside its endpoint probe in `infrastructure/ai/jev-connection-verification.ts`. Redundant model/vector connection re-export shims were removed because callers already use the bootstrap or infrastructure entry points.

[Application service migration evidence](application-services-migration.md) records the file map, high-impact callers and focused verification. Settings remains a CRITICAL-impact facade, so its move preserves all existing exports and read/write behavior.

### Ingestion event transport

The per-conversation ingestion stream lives under `http/streams/`; A2UI v0.9 task-card projection lives under `infrastructure/transports/` and uses the public Wiki job type. The stream retains the current Wiki ingestion application façade as a transition bridge. Business domains, Agent Runtime and infrastructure do not import the HTTP stream. `apps/server/architecture/ingestion-transport-boundary.ts` checks these dependencies.

Answer and tool-result projection into A2UI v0.9 lives in `infrastructure/transports/a2ui/`. The Agent Runtime consumes its input/output contracts by type, while bootstrap constructs the composer and its Wiki source-reference provider. This output projection remains separate from Agent execution and from the ingestion-task A2UI transport. [AI adapters and A2UI migration evidence](ai-adapters-a2ui-migration.md) records the moved files and checks.

[Three small module migrations](small-server-modules-migration.md) records the selected scope, impact, behavior constraints and verification.

## Client Layer Hierarchy

```
types          No app imports (pure definitions)
services       types only (API client)
shared         services/, types (shared UI components)
features       shared/, services/, types (feature modules)
components     features/, shared/, types (global UI)
App            components/, features/, types (entry point)
```

**Rule:** Feature modules must not import from other features. Use shared/ for cross-feature code.

## Exceptions

- **Provider pattern:** Cross-cutting concerns (auth, config, logging) are injected via providers, not direct imports. See `docs/golden-principles/IMPORTS.md`.
- **Type-only imports:** `import type { X }` from any layer is always allowed — type imports are erased at compile time and create no runtime dependency.

## Violation Remediation

When you see a violation like:

```
VIOLATION: apps/server/endpoints/foo.ts imports apps/server/repositories/bar.ts
— endpoints cannot import repositories directly. See docs/architecture/LAYERS.md
```

**Fix:** Route through an application use case or owning domain API, then import that public API from the endpoint.

```typescript
// BAD: endpoint imports repository directly
import { getConversation } from '../repositories/conversationRepository';

// GOOD: endpoint imports the public domain API
import { getConversation } from '../domains/conversations/index.js';
```
