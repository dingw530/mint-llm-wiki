# Architecture Layers

Mint is a TypeScript monorepo with three independent packages. Each package has its own internal layer hierarchy. Cross-package imports follow strict rules.

## Package Structure

```
client/          React SPA — UI layer
server/          Express API — backend layer
electron/        Desktop shell — wrapper layer
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
types          No app imports (pure definitions)
migrations     types only (database schema)
repositories   migrations/, types (data access)
services       repositories/, types (business logic)
endpoints      services/, middleware/, types (API handlers)
middleware     services/, types (request processing)
```

**Rule:** Each layer may only import from layers to its LEFT. Never skip layers (e.g., endpoints must not import repositories directly).

### Memory domain boundary (incremental migration)

The existing top-level Server layer diagram describes the current broad layout. Memory migration adds a finer boundary without implying that the other Server domains have moved:

```text
server/
  domains/memory/                 # memory policy and use cases
  infrastructure/persistence/   # memory SQLite repositories and FTS projection
  infrastructure/ai/            # memory extraction and gate adapters
  bootstrap/memory.ts             # explicit service/lifecycle composition
  services/contextProviders/      # thin request-context adapter during migration
```

Memory domain implementation imports only its own domain modules, `infrastructure/`, explicit type-only `server/types.ts` contracts, and the shared pure token estimator. Memory-specific persistence and AI adapters are composed by `bootstrap/memory.ts`; application entry points do not import those implementations directly. Infrastructure may import Memory type contracts, never Memory runtime services. Other consumers use `domains/memory/index.ts`; tests may import internal modules for focused unit coverage. Literal dynamic imports and re-exports are checked with the same rule.

`server/architecture/__tests__/memoryBoundary.test.ts` tests the policy, and `memoryBoundary.ts` resolves actual TypeScript dependencies so physical paths and deep relative imports are checked. This rule applies while the rest of `services/api/`, `repositories/`, and the server runtime remain in their current locations. Do not treat the Memory migration as completion of the wider Server structure proposal.

### Routing domain boundary (incremental migration)

```text
server/
  domains/routing/                # Agent choice rules, fallback policy, hooks and runtime ports
  infrastructure/ai/            # Jev routing provider and LLM classifier
  infrastructure/persistence/   # routing_logs repository and writer
  bootstrap/routing.ts           # RoutingService and audit-query composition
  bootstrap/routingSteps.ts      # configured provider order and adapter instances
```

Routing chooses an Agent; HTTP routing remains in the existing endpoints/routes layout.
The domain imports only its own modules, type-only `server/types.ts`, and the shared logger/error helpers. Configuration, model classification and audit writes are injected through `RoutingDependencies`. Infrastructure imports Routing type contracts through the public index; bootstrap supplies the fallback Agent id and audit method formatting. Outside domain consumers use the public index for domain APIs or `bootstrap/routing.ts` for the configured service and log queries.

`server/architecture/routingBoundary.ts` resolves static imports, re-exports and literal dynamic imports with TypeScript. Its tests reject domain dependencies on settings/models/persistence, deep consumer imports, runtime domain imports from Routing infrastructure, and direct infrastructure access outside bootstrap. Focused tests may access internal modules. The file mapping, history checks and verification limits are recorded in [Routing migration evidence](routing-domain-migration.md).

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
VIOLATION: server/endpoints/foo.ts imports server/repositories/bar.ts
— endpoints cannot import repositories directly. See docs/architecture/LAYERS.md
```

**Fix:** Route through the service layer. Move the business logic to `server/services/`, then import the service from the endpoint.

```typescript
// BAD: endpoint imports repository directly
import { getConversation } from '../repositories/conversationRepository';

// GOOD: endpoint imports service
import { getConversation } from '../services/conversationService';
```
