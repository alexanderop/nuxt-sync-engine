# Sync Engine Architecture

Your sync engine is a **local-first CRDT system** using **Last-Write-Wins (LWW)** conflict resolution.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌───────────────────────┐  │
│  │   Vue App       │   │  useSyncEngine  │   │  useRealtimeSync      │  │
│  │   (TodoItem)    │◀──│  (orchestrator) │──▶│  (WebSocket client)   │  │
│  └────────┬────────┘   └────────┬────────┘   └───────────┬───────────┘  │
│           │                     │                        │               │
│           ▼                     ▼                        │               │
│  ┌──────────────────────────────────────────┐            │               │
│  │         useLocalDatabase                  │            │               │
│  │  ┌────────────────────────────────────┐  │            │               │
│  │  │  sql.js (WASM SQLite in browser)   │  │            │               │
│  │  │  ┌──────────┐    ┌──────────────┐  │  │            │               │
│  │  │  │  todos   │    │  sync_meta   │  │  │            │               │
│  │  │  └──────────┘    └──────────────┘  │  │            │               │
│  │  └────────────────────────────────────┘  │            │               │
│  │              ▲                            │            │               │
│  │              │ persist                    │            │               │
│  │              ▼                            │            │               │
│  │  ┌────────────────────────────────────┐  │            │               │
│  │  │  OPFS (Origin Private File System) │  │            │               │
│  │  │       sync-engine.db               │  │            │               │
│  │  └────────────────────────────────────┘  │            │               │
│  └──────────────────────────────────────────┘            │               │
└────────────────────┬─────────────────────────────────────┼───────────────┘
                     │                                     │
        HTTP (Push/Pull)                          WebSocket (Real-time)
                     │                                     │
                     ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           NITRO SERVER                                   │
│  ┌─────────────────────────┐         ┌────────────────────────────────┐ │
│  │  /api/sync/push.post    │         │  /_ws WebSocket Handler        │ │
│  │  /api/sync/pull.get     │         │  (broadcast to all clients)    │ │
│  └────────────┬────────────┘         └────────────────────────────────┘ │
│               │                                                          │
│               ▼                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    better-sqlite3                                 │   │
│  │   ┌──────────────────┐  ┌───────────────────────────────────┐    │   │
│  │   │      todos       │  │  Indexes: updated_at, device_id   │    │   │
│  │   │   (id, text,     │  │           deleted                 │    │   │
│  │   │    completed,    │  └───────────────────────────────────┘    │   │
│  │   │    created_at,   │                                           │   │
│  │   │    updated_at,   │                                           │   │
│  │   │    device_id,    │                                           │   │
│  │   │    deleted)      │                                           │   │
│  │   └──────────────────┘                                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CRDT Metadata (The `$jazz` Pattern)

Every synced item carries metadata for conflict resolution:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Todo Item                                │
├─────────────────────────────────────────────────────────────────┤
│  User Data:              │  CRDT Metadata ($jazz):              │
│  ┌────────────────────┐  │  ┌────────────────────────────────┐  │
│  │ text: "Buy milk"   │  │  │ id: "abc-123-uuid"             │  │
│  │ completed: false   │  │  │ createdAt: 1706745600000       │  │
│  └────────────────────┘  │  │ updatedAt: 1706745660000       │  │
│                          │  │ deviceId: "device-A"           │  │
│                          │  │ deleted: false                 │  │
│                          │  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Last-Write-Wins Conflict Resolution

```
     Device A                                      Device B
         │                                             │
         │  Edit: "Buy milk" → "Buy oat milk"          │
         │  updatedAt: 1000                            │
         │                                             │
         │                 Edit: "Buy milk" → "Buy almond milk"
         │                                   updatedAt: 1001
         │                                             │
         ▼                                             ▼
    ┌─────────┐                                  ┌─────────┐
    │ Push to │                                  │ Push to │
    │ Server  │                                  │ Server  │
    └────┬────┘                                  └────┬────┘
         │                                             │
         └──────────────────┬──────────────────────────┘
                            ▼
              ┌─────────────────────────────┐
              │        SERVER MERGE         │
              │                             │
              │  if (incoming.updatedAt >   │
              │      existing.updatedAt)    │
              │    → incoming wins          │
              │                             │
              │  if (same timestamp)        │
              │    → higher deviceId wins   │
              │      (deterministic tie-    │
              │       breaker)              │
              └─────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │  Result: "Buy almond milk"  │
              │  (updatedAt: 1001 wins)     │
              └─────────────────────────────┘
```

### Conflict Resolution Logic

From `utils/sync-protocol.ts`:

```typescript
function shouldIncomingWin(incoming: Todo, existing: Todo): boolean {
  if (incoming.updated_at > existing.updated_at) {
    return true  // Newer timestamp wins
  }
  if (incoming.updated_at === existing.updated_at) {
    // Deterministic tiebreaker: compare device IDs lexicographically
    return incoming.device_id > existing.device_id
  }
  return false
}
```

---

## 4. Sync Protocol Flow

### Push/Pull Cycle (HTTP)

```
          CLIENT                                        SERVER
             │                                             │
             │  ═══════════════ PUSH ═══════════════▶      │
             │  POST /api/sync/push                        │
             │  {                                          │
             │    schema: "todos",                         │
             │    deviceId: "device-A",                    │
             │    changes: [                               │
             │      { id, data, updatedAt, ... }           │
             │    ]                                        │
             │  }                                          │
             │                                             │
             │                              ┌──────────────┤
             │                              │ For each:    │
             │                              │ - Check if   │
             │                              │   exists     │
             │                              │ - Compare    │
             │                              │   timestamps │
             │                              │ - Upsert or  │
             │                              │   conflict   │
             │                              └──────────────┤
             │                                             │
             │  ◀═══════════════════════════════════════   │
             │  {                                          │
             │    stored: 5,                               │
             │    conflicts: [...],  ← Server had newer    │
             │    syncedAt: 170674...                      │
             │  }                                          │
             │                                             │
             │  ═══════════════ PULL ═══════════════▶      │
             │  GET /api/sync/pull?since=1706...           │
             │      &deviceId=device-A                     │
             │      &schema=todos                          │
             │                                             │
             │                              ┌──────────────┤
             │                              │ SELECT *     │
             │                              │ WHERE        │
             │                              │  updated_at  │
             │                              │    > since   │
             │                              │ AND device_id│
             │                              │   != deviceA │
             │                              └──────────────┤
             │                                             │
             │  ◀═══════════════════════════════════════   │
             │  {                                          │
             │    changes: [...],  ← From other devices    │
             │    syncedAt: 170674...                      │
             │  }                                          │
             │                                             │
         ┌───┴───┐                                         │
         │ Apply │                                         │
         │ using │                                         │
         │  LWW  │                                         │
         └───┬───┘                                         │
             │                                             │
         ┌───┴───┐                                         │
         │Persist│                                         │
         │ to    │                                         │
         │ OPFS  │                                         │
         └───────┘
```

### Real-Time Sync (WebSocket)

```
    Device A              SERVER               Device B
        │                   │                      │
        │ ══ connect ══▶    │                      │
        │                   │   ◀══ connect ══     │
        │                   │                      │
        │  User edits todo  │                      │
        │         │         │                      │
        │         ▼         │                      │
        │ ══ sync msg ══▶   │                      │
        │ {                 │                      │
        │   type: 'sync',   │                      │
        │   deviceId: 'A',  │                      │
        │   changes: [...]  │                      │
        │ }                 │                      │
        │                   │                      │
        │               ┌───┴───┐                  │
        │               │Publish│                  │
        │               │to all │                  │
        │               └───┬───┘                  │
        │                   │                      │
        │                   │  ══ sync msg ══▶     │
        │                   │  (same payload)      │
        │                   │                      │
        │                   │              ┌───────┤
        │                   │              │ Check │
        │                   │              │device │
        │                   │              │ != A  │
        │                   │              │ Apply!│
        │                   │              └───────┤
        │                   │                      │
        │                   │          UI updates  │
        │                   │          instantly   │
        ▼                   ▼                      ▼
```

---

## 5. Database Schema for Sync Tracking

```
┌──────────────────────────────────────────────────────────────────────┐
│                           todos TABLE                                 │
├──────────────────────────────────────────────────────────────────────┤
│  id          TEXT PRIMARY KEY     ← UUID, globally unique            │
│  text        TEXT NOT NULL        ← User data                        │
│  completed   INTEGER DEFAULT 0    ← User data (boolean as int)       │
│  created_at  INTEGER NOT NULL     ← Preserved on updates             │
│  updated_at  INTEGER NOT NULL     ← LWW comparison key ◄── INDEXED   │
│  device_id   TEXT NOT NULL        ← Origin device      ◄── INDEXED   │
│  deleted     INTEGER DEFAULT 0    ← Soft delete flag   ◄── INDEXED   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                         sync_meta TABLE                               │
├──────────────────────────────────────────────────────────────────────┤
│  key         TEXT PRIMARY KEY     │  value        TEXT NOT NULL      │
├───────────────────────────────────┼──────────────────────────────────┤
│  "last_sync_at"                   │  "1706745600000"                 │
│                                   │  (timestamp for incremental sync)│
└───────────────────────────────────┴──────────────────────────────────┘
```

### Schema Definition

From `utils/schema.ts`:

```typescript
export const Todo = co.map({
  text: z.string().min(1),
  completed: z.boolean(),
}, 'todos')
```

---

## 6. Offline-First Data Flow

```
                    ┌─────────────────────────────────────┐
                    │           USER ACTION               │
                    │      (create/edit/delete todo)      │
                    └─────────────────┬───────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │     WRITE TO LOCAL SQLite           │
                    │     (sql.js WASM in memory)         │
                    │                                     │
                    │  • Set updatedAt = Date.now()       │
                    │  • Set deviceId = this device       │
                    │  • UI updates IMMEDIATELY           │
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────┴───────────────────┐
                    │                                     │
               ONLINE?                              OFFLINE?
                    │                                     │
                    ▼                                     ▼
     ┌──────────────────────────┐        ┌────────────────────────────┐
     │  BROADCAST via WebSocket │        │  PERSIST to OPFS           │
     │  (real-time to others)   │        │  (survives page refresh)   │
     │          +               │        │                            │
     │  PUSH/PULL on next sync  │        │  Changes queued locally    │
     └──────────────────────────┘        │  until back online         │
                                         └────────────────────────────┘
                                                      │
                                                      │ (when online)
                                                      ▼
                                         ┌────────────────────────────┐
                                         │  SYNC automatically        │
                                         │  Push local → Pull remote  │
                                         │  Merge with LWW            │
                                         └────────────────────────────┘
```

---

## 7. Key Files

| File | Purpose |
|------|---------|
| `utils/co.ts` | CRDT operations and metadata helpers |
| `utils/sync-protocol.ts` | Conflict resolution logic |
| `utils/schema.ts` | Schema definitions with Zod validation |
| `app/composables/useLocalDatabase.ts` | Client-side sql.js wrapper |
| `app/composables/useSyncEngine.ts` | Push/pull orchestration |
| `app/composables/useRealtimeSync.ts` | WebSocket real-time sync |
| `server/api/sync/push.post.ts` | Server push endpoint |
| `server/api/sync/pull.get.ts` | Server pull endpoint |
| `server/routes/_ws.ts` | WebSocket handler |

---

## 8. Design Principles

| Aspect | Implementation |
|--------|----------------|
| **Conflict Strategy** | Last-Write-Wins (timestamp + deviceId tiebreaker) |
| **Deletion** | Soft deletes only (`deleted: true`) |
| **Persistence** | OPFS for durability, falls back to memory |
| **Real-time** | WebSocket broadcast to all clients |
| **Incremental Sync** | `since` timestamp avoids full table scans |
| **Wire Format** | JSON over HTTP/WS |

---

## 9. Comparison with Jazz

| Feature | This Project | Jazz |
|---------|-------------|------|
| **Conflict Resolution** | Timestamp + Device ID | CRDT + Sessions |
| **Cryptography** | None | Signatures on all changes |
| **Permissions** | None | Granular permissions |
| **Wire Format** | JSON | Binary encoding |
| **Delete Strategy** | Soft deletes only | Tombstones + cleanup |
| **Real-time Sync** | Broadcast | Subscription-based |
| **Offline Support** | Full (local SQLite) | Full + state recovery |

This implementation demonstrates the core concepts of Jazz while using pragmatic shortcuts for simplicity. The timestamp-based CRDT works well for todo apps but wouldn't scale to complex concurrent editing scenarios (like collaborative documents).
