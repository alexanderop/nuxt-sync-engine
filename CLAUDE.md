# CLAUDE.md

Nuxt Sync Engine is a local-first todo app demonstrating sync between client-side SQLite (sql.js WASM) and server-side SQLite (better-sqlite3) using CRDTs.

## Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm setup:wasm   # Copy sql.js WASM to public/
```

## Stack

- Nuxt 4, Vue 3, TypeScript
- sql.js (client WASM) + better-sqlite3 (server)
- WebSockets for real-time sync

## Structure

- `app/` - Vue application (components, composables, pages)
- `server/` - API endpoints, database, WebSocket routes
- `shared/types/` - Shared TypeScript types
- `utils/` - Core sync logic
  - `co.ts` - CRDT operations (Conflict-free Replicated Data Types)
  - `sync-protocol.ts` - Sync protocol implementation
  - `schema.ts` - Database schema definitions

## Testing

```bash
pnpm test:native  # Quick check for better-sqlite3 bindings
pnpm test:run     # All server/unit tests
pnpm test:nuxt    # Nuxt integration tests
```

## Further Reading

**IMPORTANT:** Before starting any task, identify which docs below are relevant and read them first.

- `docs/testing-strategy.md` - Test structure, commands, CI setup, troubleshooting
- `docs/sync-engine-gotchas.md` - sql.js WASM, COOP/COEP headers, Vite config
- `docs/SYSTEM_KNOWLEDGE_MAP.md` - Architecture overview, data flow, key files
