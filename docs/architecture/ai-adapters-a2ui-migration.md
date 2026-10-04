# AI Adapters and A2UI Migration Evidence

Date: 2026-10-04. Base: `79a931d`. Engineering refactor; unrelated staged and unstaged work remains untouched.

## Scope and boundaries

- `services/adapters/` moved to `infrastructure/ai/adapters/`. Provider protocol construction, message/tool conversion, normalized AI SDK stream parsing, and the provider registry remain the adapter layer. Agent Runtime bootstrap continues to register the built-in providers; ToolLoop execution, approval, AgentRun and SSE event mapping remain unchanged.
- `services/a2ui/` moved to `infrastructure/transports/a2ui/`. The composer projects answer/tool-result events into A2UI output and persisted UI blocks. Agent Runtime consumes the contracts by type; bootstrap constructs the concrete composer. Wiki reference cards remain the existing provider implementation. Ingestion-job A2UI stays in its separate transport module.
- Moved TS filenames use kebab-case. Callers, architecture-boundary fixtures and Vitest coverage paths now point to the new locations; provider protocols, output payloads and persistence shapes were not changed.

## Verification

- Focused tests: 13 files, 118 tests passed, including adapter contracts, A2UI composer, Agent Runtime composition/react loop, Wiki compiler, graph generation, routing, model verification and both relevant boundary suites.
- Server typecheck, Prettier on modified TS files, and `git diff --check` passed.
- No live model-provider requests were sent; provider tests use local mocks.
- A temporary index initialized from `HEAD` recognized all 11 moved files as renames using `--find-renames=20%`. The Anthropic and OpenAI Responses adapters have 37% and 41% similarity after required kebab-case/Prettier changes; use `git log --follow --find-renames=20%` for those two paths. The real index was not used by the history probe.

This migration is not committed yet.
