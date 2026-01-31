# Build Your Own Jazz-Inspired Sync Engine with Nuxt 4

Ever wondered how apps like Notion, Linear, or Figma keep your data in sync across devices while still working offline? In this post, we'll build a **local-first sync engine** from scratch using Nuxt 4 and SQLite—inspired by [Jazz](https://jazz.tools).

This isn't just another todo app tutorial. We're building an educational reference that teaches you the fundamentals of sync engines while showing you what production frameworks like Jazz handle for you.

## What We're Building

A todo app that:
- Works **completely offline** (SQLite in your browser via OPFS)
- **Syncs across devices** with last-write-wins conflict resolution
- Uses a **Jazz-like API** (`co.map()`, `useCoState()`)
- Provides **real-time updates** via WebSocket

## The Jazz-Inspired API

Before diving into implementation, let's see how our API compares to Jazz:

```typescript
// ═══════════════════════════════════════════════════════════
// JAZZ (Production Framework)
// ═══════════════════════════════════════════════════════════
import { co, z } from 'jazz-tools' // Auto-syncs with cryptographic verification!

// ═══════════════════════════════════════════════════════════
// OUR VERSION (Educational)
// ═══════════════════════════════════════════════════════════
import { co, z } from './utils/co'

// Define schema
export const Todo = co.map({
  text: co.plainText(), // Collaborative text with CRDT
  completed: z.boolean(),
}).withPermissions({
  onInlineCreate: 'sameAsContainer',
})

// In a component
const todo = useCoState(Todo, () => props.todoId)
todo.completed = true

// Define schema
export const Todo = co.map({
  text: z.string(),
  completed: z.boolean(),
}, 'todos')

// In a component
const { data, update } = useCoState<TodoData>('todos', () => props.todoId)
await update({ completed: true }) // Explicit sync call
```

> **What Jazz Does Better**
>
> Jazz's real `co.map()` provides:
> - **Cryptographic signatures** on all changes
> - **Session-based transaction ordering** (not just timestamps)
> - **Automatic permission inheritance**
> - **End-to-end encryption**
> - **CRDT-based collaborative editing**
>
> Our version uses simple timestamps and last-write-wins—great for learning, but you'll want Jazz for production.

## The Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  ┌─────────────────┐      ┌────────────────┐                │
│  │    Vue App      │◄────►│    sql.js      │                │
│  │  (Composables)  │      │  (WebAssembly) │                │
│  └────────┬────────┘      └───────┬────────┘                │
│           │                       │                          │
│           │                ┌──────▼────────┐                │
│           │                │     OPFS      │                │
│           │                │  (Persisted)  │                │
│           │                └───────────────┘                │
│           ▼                                                  │
│  ┌─────────────────┐                                        │
│  │   Sync Engine   │◄─────── WebSocket ──────────────┐      │
│  │   (Push/Pull)   │                                 │      │
│  └─────────────────┘                                 │      │
└──────────────────────────────────────────────────────│──────┘
                                                       │
┌──────────────────────────────────────────────────────│──────┐
│                  Nuxt 4 Server (Nitro)               │      │
│  ┌─────────────────┐      ┌────────────────┐         │      │
│  │   REST API      │◄────►│ better-sqlite3 │◄────────┘      │
│  │  /api/sync/*    │      │    (SQLite)    │                │
│  └─────────────────┘      └────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

## Jazz's Sync Protocol vs Ours

Jazz uses a sophisticated 4-message sync protocol. We simplify it for teaching:

| Jazz Message | Our Version | Purpose |
|--------------|-------------|---------|
| `Load` | `want` | "I want this document" |
| `KnownState` | `have` | "Here's what I have" (metadata only) |
| `NewContent` | `changes` | "Here are the actual changes" |
| `Done` | `ack` | "Sync complete" |

> **What Jazz Does Better**
>
> Jazz's `KnownState` message includes per-session transaction counts:
> ```typescript
> {
>   id: "co_abc123",
>   sessions: {
>     "session_alice_laptop": 42,  // Alice has 42 transactions
>     "session_bob_phone": 17,     // Bob has 17 transactions
>   }
> }
> ```
> This allows syncing only the **exact missing transactions**—no redundant data transfer.
>
> We use a single `lastSyncAt` timestamp, which is simpler but less efficient.

## Project Structure

```
nuxt-sync-engine/
├── app/
│   ├── components/
│   │   ├── SyncStatus.vue       # Sync indicator
│   │   └── TodoItem.vue         # Todo component
│   ├── composables/
│   │   ├── useCoState.ts        # Jazz-like reactive subscription
│   │   ├── useDeviceId.ts       # Device identification
│   │   ├── useLocalDatabase.ts  # SQLite + OPFS
│   │   ├── useRealtimeSync.ts   # WebSocket handler
│   │   └── useSyncEngine.ts     # Sync orchestration
│   └── pages/
│       └── index.vue            # Main app
├── server/
│   ├── api/sync/
│   │   ├── push.post.ts         # Receive changes
│   │   └── pull.get.ts          # Send changes
│   ├── database/
│   │   └── index.ts             # Server SQLite
│   └── routes/
│       └── _ws.ts               # WebSocket handler
├── shared/types/
│   └── index.ts                 # Shared types
└── utils/
    ├── co.ts                    # Jazz-like schema builder
    ├── schema.ts                # App schemas
    └── sync-protocol.ts         # Protocol types
```

## Step 1: Schema System (`utils/co.ts`)

Our Jazz-inspired schema builder generates SQLite tables from declarative schemas:

```typescript
import { co, z } from './utils/co'

// Define a schema (Jazz-like API)
export const Todo = co.map({
  text: z.string().min(1, 'Todo text cannot be empty'),
  completed: z.boolean(),
}, 'todos')

// Create an instance
const todo = Todo.create(
  { text: 'Buy milk', completed: false },
  { deviceId: myDeviceId }
)

// Access Jazz-like metadata
console.log(todo.$jazz.id) // "550e8400-e29b-41d4-a716-446655440000"
console.log(todo.$jazz.createdAt) // 1706745600000
console.log(todo.$jazz.updatedAt) // 1706745600000
console.log(todo.$jazz.deviceId) // "device_abc123"

// Generate SQLite table
console.log(Todo.toSql())
// CREATE TABLE IF NOT EXISTS todos (
//   id TEXT NOT NULL,
//   created_at INTEGER NOT NULL,
//   updated_at INTEGER NOT NULL,
//   device_id TEXT NOT NULL,
//   deleted INTEGER NOT NULL DEFAULT 0,
//   text TEXT NOT NULL,
//   completed INTEGER,
//   PRIMARY KEY (id)
// );
```

> **What Jazz Does Better**
>
> Jazz's schema system also provides:
> - `co.profile()` - User profiles with automatic public visibility
> - `co.account()` - Full account schemas with migrations
> - `co.plainText()` - Collaborative text editing (CRDT)
> - `co.richText()` - Rich text with formatting
> - `co.image()` - Image handling with progressive loading
> - `.withPermissions()` - Fine-grained access control
> - `.withMigration()` - Schema versioning and upgrades
>
> We only implement `co.map()` for simplicity.

## Step 2: Reactive State (`useCoState`)

Our Jazz-inspired composable provides reactive subscriptions to data:

```typescript
// In a component
const { data, status, update, remove } = useCoState<TodoData>(
  'todos',
  () => props.todoId
)

// Watch for changes
watch(data, (newValue) => {
  console.log('Todo updated:', newValue)
})

// Update (explicit call required)
await update({ completed: true })

// Delete (soft delete for sync)
await remove()
```

For lists:

```typescript
const { items, create, update, remove } = useCoStateList<TodoData>('todos')

// Create
const newTodo = await create({ text: 'New todo', completed: false })

// Update
await update(todoId, { completed: true })

// Delete
await remove(todoId)
```

> **What Jazz Does Better**
>
> Jazz's `useCoState` provides true reactive Proxy:
> ```typescript
> const todo = useCoState(Todo, () => props.todoId)
>
> // Direct mutation - auto-syncs!
> todo.completed = true
>
> // No explicit update() call needed
> // Changes are batched and synced automatically
> ```
>
> We require explicit `update()` calls because implementing a full Proxy
> system with batching and rollback is complex.

## Step 3: Local Database (`useLocalDatabase`)

SQLite runs in the browser via sql.js (WebAssembly) with OPFS persistence:

```typescript
// Initialize database (creates tables from schemas)
const db = await useLocalDatabase()

// Query helpers
const todos = queryAll<TodoRow>(
  'SELECT * FROM todos WHERE deleted = 0 ORDER BY updated_at DESC'
)

// Execute statements
execute(
  'UPDATE todos SET completed = ? WHERE id = ?',
  [1, todoId]
)

// Persist to OPFS
await persistDatabase()
```

> **What Jazz Does Better**
>
> Jazz uses content-addressed storage:
> - Every piece of data has a unique, deterministic ID based on its content
> - Changes are stored as an append-only log
> - Automatic garbage collection removes orphaned data
> - Efficient incremental sync
>
> We use traditional SQL with timestamps—simpler but less sophisticated.

## Step 4: Sync Engine (`useSyncEngine`)

The sync engine orchestrates push/pull operations:

```typescript
const {
  state, // { isSyncing, isOnline, isConnected, lastSyncAt, error }
  sync, // Manual sync trigger
  push, // Push local changes
  pull, // Pull remote changes
} = useSyncEngine({
  tableName: 'todos',
  autoSyncInterval: 30000,
  onRemoteChanges: (changes) => {
    console.log('Received remote changes:', changes)
    refresh() // Re-query local database
  },
})

// Trigger sync after local changes
await sync()
```

### Conflict Resolution: Last-Write-Wins

```typescript
function shouldRemoteWin(remote: SyncItem, local: SyncItem): boolean {
  // Higher timestamp wins
  if (remote.updatedAt > local.updatedAt)
    return true
  if (remote.updatedAt < local.updatedAt)
    return false

  // Tiebreaker: higher device ID (deterministic)
  return remote.deviceId > local.deviceId
}
```

> **What Jazz Does Better**
>
> Jazz supports multiple conflict resolution strategies:
>
> 1. **CRDT merging**: Automatic merge of concurrent text edits
> 2. **Session ordering**: Causal relationships between changes
> 3. **Branching**: Create explicit branches (like Git)
> 4. **Custom merge**: Define your own merge functions
>
> LWW can lose data if two users edit simultaneously. Jazz preserves both edits.

## Step 5: Real-Time Sync (`useRealtimeSync`)

WebSocket broadcasts changes to all connected clients:

```typescript
const { connect, broadcast, isConnected } = useRealtimeSync({
  onChanges: (changes, schema) => {
    // Apply changes from other devices
    syncEngine.applyWebSocketChanges(changes)
    refresh()
  },
})

// Connect on mount
onMounted(connect)

// Broadcast after local changes
const newTodo = await create({ text: 'Hello', completed: false })
broadcast('todos', [newTodo])
```

> **What Jazz Does Better**
>
> Jazz's real-time sync provides:
> - **Subscriptions**: Only sync CoValues you're actually using
> - **Presence**: Know who else is viewing/editing
> - **Cursors**: Sync cursor positions for collaboration
> - **Efficient diffing**: Only send changed bytes
>
> We broadcast all changes to all clients—simple but not scalable.

## Step 6: Server API

### Push Endpoint (`/api/sync/push`)

```typescript
// server/api/sync/push.post.ts
export default defineEventHandler(async (event) => {
  const { schema, changes, deviceId, lastSyncAt } = await readBody(event)

  // Process each change
  const { stored, conflicts } = batchUpsert(schema, changes)

  return {
    syncedAt: Date.now(),
    conflicts, // Items where server had newer version
    stored,
  }
})
```

### Pull Endpoint (`/api/sync/pull`)

```typescript
// server/api/sync/pull.get.ts
export default defineEventHandler(async (event) => {
  const { schema, since, deviceId } = getQuery(event)

  // Get changes, excluding requester's own changes
  const changes = getChangesSince(schema, since, deviceId)

  return {
    changes,
    syncedAt: Date.now(),
  }
})
```

### WebSocket Handler

```typescript
// server/routes/_ws.ts
export default defineWebSocketHandler({
  open(peer) {
    peer.subscribe('sync-channel')
  },

  message(peer, message) {
    const data = JSON.parse(message.text())

    if (data.type === 'sync') {
      // Broadcast to all other peers
      peer.publish('sync-channel', message.text())
    }
  },
})
```

## What We Simplified (And Why Jazz Is Better)

| Concept | Jazz | Our Version | Why Jazz Is Better |
|---------|------|-------------|-------------------|
| **Change Tracking** | Session + transaction index | Timestamps | Causal ordering, no clock sync needed |
| **Conflict Resolution** | CRDTs + branching | Last-write-wins | No data loss, true merging |
| **Permissions** | Groups, roles, crypto | Implicit trust | Fine-grained access control |
| **Encryption** | End-to-end | None | Data privacy |
| **Verification** | Cryptographic signatures | None | Tamper-proof |
| **Protocol** | Binary, efficient | JSON | Less bandwidth |
| **Sync** | Incremental, partial | Full sync | Faster, less data |

## When to Use What

### Build Your Own (Like This Tutorial) When:
- Learning how sync engines work
- Simple data model (like our todo app)
- Full control over every detail is required
- Small team, limited complexity

### Use Jazz When:
- Building a production app
- Need multi-user collaboration
- Complex data relationships
- Require end-to-end encryption
- Need offline-first as a core feature
- Want to ship faster

## Running the Demo

```bash
# Install dependencies
npm install

# Copy WASM file for sql.js
npm run setup:wasm

# Start development server
npm run dev
```

Then open http://localhost:3000 in multiple browser tabs to see real-time sync!

### Testing Scenarios

1. **Real-time sync**: Add a todo in one tab, see it appear in another
2. **Offline mode**: Go offline in DevTools, add todos, go online
3. **Conflict**: Edit the same todo offline in two tabs, see LWW in action

## Key Takeaways

1. **Local-first is powerful**: SQLite in the browser with OPFS persistence provides a great offline experience

2. **Sync is complex**: Even our simplified version required careful handling of conflicts, timestamps, and state

3. **Jazz abstracts the hard parts**: Cryptographic verification, CRDTs, permissions, and efficient sync protocols are non-trivial to implement correctly

4. **The Jazz API is elegant**: `co.map()` and `useCoState()` provide a clean, declarative way to define and use synced data

## Resources

### Jazz
- [Jazz Documentation](https://jazz.tools/docs)
- [Jazz GitHub](https://github.com/garden-co/jazz)
- [Jazz Examples](https://github.com/garden-co/jazz/tree/main/examples)

### SQLite in the Browser
- [sql.js](https://github.com/sql-js/sql.js) - SQLite compiled to WebAssembly
- [@sqlite.org/sqlite-wasm](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm) - Official SQLite WASM
- [OPFS on MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

### Local-First
- [Local-First Software](https://www.inkandswitch.com/local-first/) - The seminal Ink & Switch paper
- [CRDTs Explained](https://crdt.tech/) - Learn about Conflict-free Replicated Data Types

---

*The complete working code for this tutorial is available in the Jazz repository: [examples/nuxt-sync-engine](https://github.com/garden-co/jazz/tree/main/examples/nuxt-sync-engine)*
