# Architecture

## Overview

Mint is a TypeScript monorepo for an AI chat desktop application. Three packages with clear boundaries:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   electron   │────→│   client    │────→│   server    │
│  (desktop)   │     │  (React)    │     │  (Express)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Packages

| Package     | Purpose                                     | Tech                                |
| ----------- | ------------------------------------------- | ----------------------------------- |
| `server/`   | REST API, AI adapters, SQLite storage       | Express, better-sqlite3, TypeScript |
| `client/`   | Chat UI, settings, Wiki and Agent workbench | React 18, Vite, TypeScript          |
| `electron/` | Desktop packaging                           | Electron, electron-builder          |

## Layer Hierarchy

See [docs/architecture/LAYERS.md](docs/architecture/LAYERS.md) for detailed layer rules and violation remediation.

## Key Data Flows

- **Chat:** Client → POST /api/messages → Server → AI API (streaming SSE) → Client
- **ReAct:** Server orchestrator → Tool execution loop → Streamed steps → Client
- **Wiki:** File upload → Parse → Compile → Query (AI-accessible during chat)

## Golden Principles

See [docs/golden-principles/](docs/golden-principles/) for coding conventions:

- `IMPORTS.md` — Import rules and layer boundaries
- `NAMING.md` — File and variable naming conventions
- `ERROR_HANDLING.md` — Error patterns and response format
- `TESTING.md` — Test structure and isolation rules
