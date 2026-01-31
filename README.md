# Nuxt Sync Engine

A local-first todo application demonstrating real-time data synchronization between client-side SQLite and server-side SQLite using CRDTs (Conflict-free Replicated Data Types).

Built as an educational project inspired by [Jazz](https://jazz.tools/) to explore sync engine fundamentals.

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy sql.js WASM to public directory (required)
pnpm setup:wasm

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Features

- **Local-First** - Works fully offline with client-side SQLite (sql.js WASM)
- **Real-Time Sync** - WebSocket-based bidirectional synchronization
- **Conflict Resolution** - Last-Write-Wins (LWW) with deterministic tiebreaker
- **Multi-Device** - Changes sync across browser tabs and devices
- **Persistent Storage** - OPFS persistence with fallback support
- **Type-Safe** - Full TypeScript with Zod validation

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER                                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │ Vue          │ → │ Composables  │ → │ sql.js WASM  │    │
│  │ Components   │   │ (useCoState) │   │ SQLite       │    │
│  └──────────────┘   └──────────────┘   └──────────────┘    │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP + WebSocket
┌─────────────────────────────┴───────────────────────────────┐
│  SERVER                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │ Nitro        │ → │ Sync API     │ → │ better-      │    │
│  │ Runtime      │   │ + WebSocket  │   │ sqlite3      │    │
│  └──────────────┘   └──────────────┘   └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### CRDT Conflict Resolution

Every synced item carries metadata for conflict resolution:

```typescript
interface CRDTMetadata {
  id: string          // UUID (globally unique)
  createdAt: number   // Unix timestamp (ms)
  updatedAt: number   // Used for LWW resolution
  deviceId: string    // Tiebreaker when timestamps match
  deleted: boolean    // Soft delete flag
}
```

**Last-Write-Wins (LWW) Logic:**
1. Compare `updatedAt` timestamps - newer wins
2. If timestamps match, compare `deviceId` lexicographically (deterministic tiebreaker)

### Sync Protocol

- **HTTP Push/Pull** - Periodic sync every 30 seconds
  - `POST /api/sync/push` - Send local changes to server
  - `GET /api/sync/pull` - Fetch changes from server
- **WebSocket** - Real-time broadcast to all connected clients

## Project Structure

```
nuxt-sync-engine/
├── app/                      # Vue 3 frontend
│   ├── components/           # UI components (TodoItem, SyncStatus)
│   ├── composables/          # Reactive logic
│   │   ├── useCoState.ts     # Jazz-like state subscription
│   │   ├── useLocalDatabase.ts   # sql.js with OPFS
│   │   ├── useRealtimeSync.ts    # WebSocket client
│   │   └── useSyncEngine.ts      # Sync orchestration
│   └── pages/                # Route pages
├── server/                   # Nitro backend
│   ├── api/sync/             # Push/pull endpoints
│   ├── routes/_ws.ts         # WebSocket handler
│   └── utils/db.ts           # Server database
├── utils/                    # Core sync logic
│   ├── co.ts                 # CRDT operations
│   ├── sync-protocol.ts      # Sync protocol types
│   └── schema.ts             # Database schemas
├── shared/types/             # Shared TypeScript types
└── docs/                     # Documentation
```

## Commands

```bash
# Development
pnpm dev              # Start dev server

# Production
pnpm build            # Build for production
pnpm preview          # Preview production build

# Setup
pnpm setup:wasm       # Copy sql.js WASM to public/

# Testing
pnpm test:run         # Run all tests
pnpm test:native      # Quick better-sqlite3 check
pnpm test:nuxt        # Nuxt integration tests

# Code Quality
pnpm typecheck        # TypeScript checking
pnpm lint             # Run linters
pnpm lint:fix         # Auto-fix issues
```

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Nuxt 4, Vue 3 |
| Client DB | sql.js (WASM SQLite) |
| Server DB | better-sqlite3 |
| Real-time | WebSocket (CrossWS) |
| Validation | Zod |
| Styling | Tailwind CSS |
| Testing | Vitest |

## Documentation

Detailed documentation is available in the `/docs` directory:

- [**System Knowledge Map**](docs/SYSTEM_KNOWLEDGE_MAP.md) - Architecture overview with diagrams
- [**Sync Engine Architecture**](docs/sync-engine-architecture.md) - Deep dive into how sync works
- [**Gotchas**](docs/sync-engine-gotchas.md) - WASM setup, COOP/COEP headers
- [**Testing Strategy**](docs/testing-strategy.md) - Test structure and commands

## Inspiration

This project is inspired by [Jazz](https://jazz.tools/), a production-ready framework for building local-first apps. Our implementation simplifies Jazz's concepts for educational purposes:

| Jazz | This Project |
|------|--------------|
| CoValue (smart Proxy) | useCoState (explicit updates) |
| Sophisticated vector clocks | Simple LWW timestamps |
| CoMaps, CoLists, BinaryCoStreams | Single schema type |
| Production sync protocol | Simplified push/pull |

For production applications, consider using Jazz or similar battle-tested frameworks.

## License

MIT
