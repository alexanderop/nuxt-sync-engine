# IndexedDB Migration Technical Specification

> **Status:** Draft v2
> **Created:** 2026-02-01
> **Updated:** 2026-02-01
> **Purpose:** Implement client-side storage using IndexedDB with session-based causal ordering, adopting patterns from Jazz framework and VueUse

---

## Executive Summary

This specification details how to implement the Nuxt Sync Engine's client-side storage using IndexedDB with session-based causal ordering from the start. The implementation adopts proven patterns from Jazz framework for sync tracking and VueUse composables for Vue integration.

**Key Decisions:**
- Session-based conflict resolution (not LWW) from Phase 1
- Server-only sync tracking (single peer)
- VueUse composables for network, events, and state management
- Vitest browser mode for testing with real IndexedDB

---

## Part 1: How Jazz Uses IndexedDB

### 1.1 Database Schema Architecture

Jazz maintains **6 object stores** in IndexedDB (version 6):

```
┌─────────────────────────────────────────────────────────────────┐
│                    jazz-storage (IndexedDB)                      │
├─────────────────────────────────────────────────────────────────┤
│  coValues          │ CRDT object headers & metadata              │
│  sessions          │ Edit sessions per CoValue (causal ordering) │
│  transactions      │ Individual CRDT operations [ses, idx]       │
│  signatureAfter    │ Cryptographic signatures for streaming      │
│  unsyncedCoValues  │ Per-peer sync tracking                      │
│  deletedCoValues   │ Async deletion work queue                   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**

| Store | Key Strategy | Purpose |
|-------|--------------|---------
| `coValues` | Auto-increment + unique index on `id` | Fast lookups, stable rowIDs for joins |
| `sessions` | Auto-increment + compound index `[coValue, sessionID]` | Multiple sessions per CoValue |
| `transactions` | Composite `[ses, idx]` | Ordered operations within sessions |
| `signatureAfter` | Composite `[ses, idx]` | Streaming large objects in chunks |
| `unsyncedCoValues` | Auto-increment + compound `[coValueId, peerId]` | Resume sync after reconnection |

### 1.2 Request Queuing Pattern

Jazz solves IndexedDB's auto-commit behavior with a **sequential request queue**:

```typescript
// jazz/packages/cojson-storage-indexeddb/src/CoJsonIDBTransaction.ts
export class CoJsonIDBTransaction {
  pendingRequests: ((txEntry: this) => void)[] = [];
  running = false;

  handleRequest<T>(handler: (txEntry: this) => IDBRequest<T>) {
    return this.pushRequest<T>((txEntry, next) => {
      return new Promise<T>((resolve, reject) => {
        const request = handler(txEntry);

        request.onsuccess = () => {
          resolve(request.result);
          next();  // Process next queued request
        };

        request.onerror = () => {
          this.tx.abort();
          reject(request.error);
        };
      });
    });
  }
}
```

**Why this matters:** IndexedDB transactions auto-commit when the event loop is idle. Jazz queues operations to ensure they execute within the same transaction.

### 1.3 Multi-Level Caching

Jazz implements three caching layers:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: In-Memory CoValue Set                          │
│   private inMemoryCoValues = new Set<RawCoID>()         │
│   → Skip loading if already in memory                   │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Known State Deduplication                      │
│   private pendingKnownStateLoads = new Map<...>()       │
│   → Reuse in-flight requests for same ID                │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Store Queue for Writes                         │
│   storeQueue = new StoreQueue()                         │
│   → Batch writes, process sequentially                  │
└─────────────────────────────────────────────────────────┘
```

### 1.4 Session-Based Causal Ordering

We adopt Jazz's session-based approach which preserves **all concurrent operations**:

```
LWW Approach (NOT using):
─────────────────────────
Alice: field = "hello" (t=100)
Bob:   field = "world" (t=101)  ← WINS
Result: field = "world"

Session-Based Approach (USING):
─────────────────────────
Session A (Alice): TX0: field = "hello", TX1: field = "hello world"
Session B (Bob):   TX0: field = "goodbye"

Result: ALL operations preserved
        Application decides how to merge
```

**Known State Structure:**
```typescript
type CoValueKnownState = {
  id: RawCoID;
  header: boolean;
  sessions: { [sessionID: SessionID]: number }  // tx count per session
};

// Example:
{
  id: "co_z123",
  header: true,
  sessions: {
    "alice_session_z001": 5,  // Alice made 5 transactions
    "bob_session_z002": 3     // Bob made 3 transactions
  }
}
```

### 1.5 Sync Protocol

Jazz uses a **4-message exchange** for efficient sync:

```
┌─────────────┐                    ┌─────────────┐
│   Client    │                    │   Server    │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │──── LOAD (I need co_z123) ──────▶│
       │                                  │
       │◀─── CONTENT (header + txs) ──────│
       │                                  │
       │──── KNOWN (I have sessions...) ─▶│
       │                                  │
       │◀─── KNOWN (confirmed) ───────────│
       │                                  │
```

**Message Types:**
- `load`: Request a CoValue
- `known`: Announce what you have (or request correction)
- `content`: Send missing transactions
- `done`: Graceful completion

---

## Part 2: VueUse Integration

We replace manual implementations with VueUse composables for cleaner, more maintainable code.

### 2.1 Composables Mapping

| Need | VueUse Composable | Replaces |
|------|-------------------|----------|
| Network status | `useOnline` | Manual `addEventListener('online/offline')` |
| WebSocket | `useWebSocket` | Custom reconnection logic |
| Event cleanup | `useEventListener` | Manual `removeEventListener` |
| Provide/inject | `createInjectionState` | Custom Symbol + provide/inject |
| Async loading | `useAsyncState` | Manual `isLoading`, `error` refs |
| Batched writes | `useDebounceFn` | Custom `setTimeout` batching |
| Feature detection | `useSupported` | `if ('storage' in navigator)` checks |

### 2.2 Network Status with useOnline

```typescript
// Before (manual)
const isOnline = ref(navigator.onLine)
window.addEventListener('online', () => { isOnline.value = true })
window.addEventListener('offline', () => { isOnline.value = false })
// Must manually cleanup...

// After (VueUse)
import { useOnline } from '@vueuse/core'

const isOnline = useOnline()  // Auto-cleanup on unmount
```

### 2.3 WebSocket with useWebSocket

```typescript
import { useWebSocket } from '@vueuse/core'

const { status, data, send, open, close } = useWebSocket(
  'wss://your-server.com/sync',
  {
    autoReconnect: {
      retries: 3,
      delay: 1000,
      onFailed() {
        console.error('Failed to connect after 3 retries')
      },
    },
    heartbeat: {
      message: 'ping',
      interval: 30000,
      pongTimeout: 5000,
    },
    onConnected(ws) {
      // Resume unsynced items
      resumeUnsyncedItems()
    },
    onMessage(ws, event) {
      handleSyncMessage(JSON.parse(event.data))
    },
  }
)
```

### 2.4 Provider Pattern with createInjectionState

```typescript
// composables/useSyncEngine.ts
import { createInjectionState } from '@vueuse/core'
import { useOnline, useWebSocket } from '@vueuse/core'

const [useSyncEngineProvider, useSyncEngine] = createInjectionState(
  (options: { peer?: string } = {}) => {
    const db = shallowRef<IDBDatabase | null>(null)
    const isReady = ref(false)
    const isOnline = useOnline()
    const deviceId = getOrCreateDeviceId()

    // WebSocket with auto-reconnect
    const { status, send } = useWebSocket(options.peer ?? '', {
      autoReconnect: true,
      immediate: !!options.peer,
    })

    // Initialize IndexedDB
    initIndexedDB().then((database) => {
      db.value = database
      isReady.value = true
    })

    // Batched unsynced tracking (200ms delay like Jazz)
    const { markUnsynced, markSynced, flush } = createUnsyncedTracker(db)

    return {
      db,
      isReady,
      isOnline,
      deviceId,
      wsStatus: status,
      send,
      markUnsynced,
      markSynced,
    }
  },
  { injectionKey: Symbol('sync-engine') }
)

export { useSyncEngineProvider, useSyncEngine }
```

### 2.5 Async State with useAsyncState

```typescript
// composables/useCoState.ts
import { useAsyncState } from '@vueuse/core'

export function useCoState<T extends SyncItem>(
  collection: string,
  id: MaybeRefOrGetter<string | null | undefined>
) {
  const { db, markUnsynced } = useSyncEngine()

  const { state: data, isLoading, error, execute } = useAsyncState(
    async () => {
      const currentId = toValue(id)
      if (!currentId || !db.value) return null
      return getFromIDB<T>(db.value, collection, currentId)
    },
    null,
    { immediate: true, resetOnExecute: false }
  )

  // Re-fetch when ID changes
  watch(() => toValue(id), () => execute())

  async function update(changes: Partial<T>): Promise<void> {
    if (!data.value || !db.value) return

    const updated = {
      ...data.value,
      ...changes,
      updatedAt: Date.now(),
    }

    // Optimistic update
    data.value = updated

    // Persist & mark for sync
    await saveToIDB(db.value, collection, updated)
    markUnsynced(updated.id)
  }

  return {
    data: readonly(data),
    isLoading: readonly(isLoading),
    error: readonly(error),
    update,
  }
}
```

### 2.6 Debounced Batch Writes with useDebounceFn

```typescript
// utils/unsynced-tracker.ts
import { useDebounceFn } from '@vueuse/core'

export function createUnsyncedTracker(db: Ref<IDBDatabase | null>) {
  const pendingUpdates: Array<{ id: string; synced: boolean }> = []

  async function flushUpdates() {
    if (!db.value || !pendingUpdates.length) return

    const updates = [...pendingUpdates]
    pendingUpdates.length = 0

    const tx = db.value.transaction('unsynced', 'readwrite')
    const store = tx.objectStore('unsynced')

    for (const { id, synced } of updates) {
      if (synced) {
        const key = await promisify(store.index('by_entity').getKey(id))
        if (key) store.delete(key)
      } else {
        try {
          store.add({ entityId: id, createdAt: Date.now() })
        } catch {
          // Already exists
        }
      }
    }
  }

  // Debounce with 200ms delay (Jazz pattern)
  const debouncedFlush = useDebounceFn(flushUpdates, 200)

  function markUnsynced(entityId: string) {
    pendingUpdates.push({ id: entityId, synced: false })
    debouncedFlush()
  }

  function markSynced(entityId: string) {
    pendingUpdates.push({ id: entityId, synced: true })
    debouncedFlush()
  }

  return { markUnsynced, markSynced, flush: flushUpdates }
}
```

### 2.7 Feature Detection with useSupported

```typescript
// composables/useStorageQuota.ts
import { useSupported } from '@vueuse/core'

export function useStorageQuota() {
  const isSupported = useSupported(() =>
    'storage' in navigator && 'estimate' in navigator.storage
  )

  const quota = ref<{ usage: number; quota: number } | null>(null)
  const isLowStorage = computed(() =>
    quota.value ? quota.value.usage / quota.value.quota > 0.9 : false
  )

  async function checkQuota() {
    if (!isSupported.value) return

    const estimate = await navigator.storage.estimate()
    quota.value = {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    }
  }

  const isPersistSupported = useSupported(() =>
    'storage' in navigator && 'persist' in navigator.storage
  )

  async function requestPersistence(): Promise<boolean> {
    if (!isPersistSupported.value) return false
    return navigator.storage.persist()
  }

  return {
    isSupported,
    quota,
    isLowStorage,
    checkQuota,
    requestPersistence,
  }
}
```

---

## Part 3: Implementation Phases

### Phase 1: Core Storage + Sessions

**Goal:** Implement IndexedDB with session-based ordering from the start.

#### 3.1 Database Schema

```typescript
// app/composables/useIndexedDB.ts
const DB_NAME = 'sync-engine'
const DB_VERSION = 1

export interface SyncEngineStores {
  todos: SyncItem
  projects: SyncItem
  sessions: SessionRecord
  operations: OperationRecord
  unsynced: UnsyncedRecord
  sync_meta: { key: string; value: unknown }
}

export function useIndexedDB() {
  const db = shallowRef<IDBDatabase | null>(null)
  const isReady = ref(false)

  async function init(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const database = request.result

        // Entity stores
        if (!database.objectStoreNames.contains('todos')) {
          const todos = database.createObjectStore('todos', { keyPath: 'id' })
          todos.createIndex('by_updated_at', 'updatedAt')
          todos.createIndex('by_deleted', 'deleted')
        }

        if (!database.objectStoreNames.contains('projects')) {
          const projects = database.createObjectStore('projects', { keyPath: 'id' })
          projects.createIndex('by_updated_at', 'updatedAt')
        }

        // Session tracking (Jazz pattern)
        if (!database.objectStoreNames.contains('sessions')) {
          const sessions = database.createObjectStore('sessions', {
            autoIncrement: true,
            keyPath: 'rowID',
          })
          sessions.createIndex('by_entity', ['entityType', 'entityId'])
          sessions.createIndex('unique', ['entityType', 'entityId', 'sessionId'], {
            unique: true,
          })
        }

        // Operations within sessions
        if (!database.objectStoreNames.contains('operations')) {
          database.createObjectStore('operations', {
            keyPath: ['sessionRowId', 'idx'],
          })
        }

        // Unsynced tracking (server-only)
        if (!database.objectStoreNames.contains('unsynced')) {
          const unsynced = database.createObjectStore('unsynced', {
            autoIncrement: true,
            keyPath: 'rowID',
          })
          unsynced.createIndex('by_entity', 'entityId', { unique: true })
        }

        // Sync metadata
        if (!database.objectStoreNames.contains('sync_meta')) {
          database.createObjectStore('sync_meta', { keyPath: 'key' })
        }
      }

      request.onsuccess = () => {
        db.value = request.result
        isReady.value = true
        resolve(request.result)
      }

      request.onerror = () => reject(request.error)
    })
  }

  return { db, isReady, init }
}
```

#### 3.2 Request Queue (Jazz Pattern)

```typescript
// app/utils/idb-transaction-queue.ts
export class IDBTransactionQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  async enqueue<T>(
    db: IDBDatabase,
    storeNames: string | string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const stores = Array.isArray(storeNames) ? storeNames : [storeNames]
          const tx = db.transaction(stores, mode)
          const result = await operation(tx)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })

      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.running) return
    this.running = true

    while (this.queue.length > 0) {
      const operation = this.queue.shift()!
      await operation()
    }

    this.running = false
  }
}

export const txQueue = new IDBTransactionQueue()
```

#### 3.3 Session Tracking

```typescript
// app/composables/useSessionTracking.ts
export function useSessionTracking(db: Ref<IDBDatabase | null>, deviceId: string) {
  // Session ID is stable per device + browser session
  const sessionId = `${deviceId}_${Date.now()}_${generateId()}`

  async function recordOperation(
    entityType: string,
    entityId: string,
    operation: 'create' | 'update' | 'delete',
    changes: Record<string, unknown>
  ) {
    if (!db.value) return

    await txQueue.enqueue(
      db.value,
      ['sessions', 'operations'],
      'readwrite',
      async (tx) => {
        const sessionsStore = tx.objectStore('sessions')
        const index = sessionsStore.index('unique')

        // Get or create session for this entity
        let sessionRow = await promisify(
          index.get([entityType, entityId, sessionId])
        )

        if (!sessionRow) {
          const rowId = await promisify(
            sessionsStore.add({
              entityType,
              entityId,
              sessionId,
              lastIdx: 0,
            })
          )
          sessionRow = { rowID: rowId, lastIdx: 0 }
        }

        // Add operation
        const newIdx = sessionRow.lastIdx + 1
        tx.objectStore('operations').add({
          sessionRowId: sessionRow.rowID,
          idx: newIdx,
          operation,
          changes,
          madeAt: Date.now(),
        })

        // Update session lastIdx
        sessionsStore.put({
          ...sessionRow,
          rowID: sessionRow.rowID,
          lastIdx: newIdx,
        })
      }
    )
  }

  async function getKnownState(
    entityType: string,
    entityId: string
  ): Promise<Record<string, number>> {
    if (!db.value) return {}

    const tx = db.value.transaction('sessions', 'readonly')
    const index = tx.objectStore('sessions').index('by_entity')
    const sessions = await promisify(index.getAll([entityType, entityId]))

    const knownState: Record<string, number> = {}
    for (const session of sessions) {
      knownState[session.sessionId] = session.lastIdx
    }
    return knownState
  }

  return { sessionId, recordOperation, getKnownState }
}
```

### Phase 2: Sync Tracking

**Goal:** Implement server-only sync state tracking for resumable sync.

#### 2.1 Unsynced Tracker (Server-Only)

```typescript
// app/composables/useUnsyncedTracker.ts
import { useDebounceFn } from '@vueuse/core'

export function useUnsyncedTracker(db: Ref<IDBDatabase | null>) {
  const pendingUpdates: Array<{ id: string; synced: boolean }> = []

  async function flushUpdates() {
    if (!db.value || !pendingUpdates.length) return

    const updates = [...pendingUpdates]
    pendingUpdates.length = 0

    await txQueue.enqueue(db.value, 'unsynced', 'readwrite', async (tx) => {
      const store = tx.objectStore('unsynced')

      for (const { id, synced } of updates) {
        if (synced) {
          const key = await promisify(store.index('by_entity').getKey(id))
          if (key) store.delete(key)
        } else {
          try {
            store.add({ entityId: id, createdAt: Date.now() })
          } catch {
            // Already exists, ignore
          }
        }
      }
    })
  }

  // 200ms debounce (Jazz pattern)
  const debouncedFlush = useDebounceFn(flushUpdates, 200)

  function markUnsynced(entityId: string) {
    pendingUpdates.push({ id: entityId, synced: false })
    debouncedFlush()
  }

  function markSynced(entityId: string) {
    pendingUpdates.push({ id: entityId, synced: true })
    debouncedFlush()
  }

  async function getUnsyncedIds(): Promise<string[]> {
    if (!db.value) return []

    const tx = db.value.transaction('unsynced', 'readonly')
    const items = await promisify(tx.objectStore('unsynced').getAll())
    return items.map((i) => i.entityId)
  }

  async function getUnsyncedCount(): Promise<number> {
    if (!db.value) return 0

    const tx = db.value.transaction('unsynced', 'readonly')
    return promisify(tx.objectStore('unsynced').count())
  }

  return {
    markUnsynced,
    markSynced,
    getUnsyncedIds,
    getUnsyncedCount,
    flush: flushUpdates,
  }
}
```

#### 2.2 Resume Sync on Reconnection

```typescript
// app/composables/useSyncEngine.ts (sync portion)
import { useOnline, useWebSocket, whenever } from '@vueuse/core'

export function useSyncReconnection(options: { peer: string }) {
  const { db, markSynced } = useSyncEngine()
  const unsyncedTracker = useUnsyncedTracker(db)
  const isOnline = useOnline()

  const { status, send, data } = useWebSocket(options.peer, {
    autoReconnect: {
      retries: Infinity,
      delay: 1000,
      maxDelay: 30000,
    },
    onConnected() {
      resumeUnsyncedItems()
    },
  })

  async function resumeUnsyncedItems() {
    const unsyncedIds = await unsyncedTracker.getUnsyncedIds()
    if (!unsyncedIds.length) return

    // Load unsynced items from IndexedDB
    const items: SyncItem[] = []
    for (const table of ['todos', 'projects'] as const) {
      for (const id of unsyncedIds) {
        const item = await getFromIDB(db.value!, table, id)
        if (item) items.push(item)
      }
    }

    // Push to server
    if (items.length) {
      send(JSON.stringify({ type: 'push', items }))
    }
  }

  // Resume when coming back online
  whenever(isOnline, () => {
    if (status.value === 'OPEN') {
      resumeUnsyncedItems()
    }
  })

  return { status, send, data }
}
```

### Phase 3: Polish & Optimization

**Goal:** Performance optimizations, cleanup, and production readiness.

#### 3.1 Relaxed Durability for Performance

```typescript
// For non-critical writes (intermediate sync states)
const tx = db.transaction('unsynced', 'readwrite', { durability: 'relaxed' })
// 10-100x faster writes, data may be lost on crash
```

#### 3.2 In-Memory Caching Layer

```typescript
// app/utils/entity-cache.ts
export class EntityCache {
  private cache = new Map<string, { data: SyncItem; timestamp: number }>()
  private readonly maxAge = 5000 // 5 seconds

  get(key: string): SyncItem | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key)
      return undefined
    }

    return entry.data
  }

  set(key: string, data: SyncItem): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }
}
```

#### 3.3 Remove SQLite Dependencies

```typescript
// nuxt.config.ts - REMOVE these lines:
// vite: {
//   optimizeDeps: { exclude: ['sql.js'] }
// },
// routeRules: {
//   '/**': {
//     headers: {
//       'Cross-Origin-Opener-Policy': 'same-origin',
//       'Cross-Origin-Embedder-Policy': 'require-corp'
//     }
//   }
// }
```

```json
// package.json - REMOVE:
{
  "dependencies": {
    // "sql.js": "^1.x.x"  <- DELETE
  }
}
```

---

## Part 4: Vue Integration

### 4.1 Provider Setup

```vue
<!-- App.vue or layouts/default.vue -->
<script setup lang="ts">
import { useSyncEngineProvider } from '~/composables/useSyncEngine'

// Provides to entire app via Vue's provide/inject
useSyncEngineProvider({ peer: 'wss://your-server.com/sync' })
</script>

<template>
  <NuxtPage />
</template>
```

### 4.2 Entity Composable Usage

```vue
<!-- components/TodoItem.vue -->
<script setup lang="ts">
import { useCoState } from '~/composables/useCoState'
import type { Todo } from '~/types'

const props = defineProps<{ todoId: string }>()

// Reactive getter - re-subscribes when prop changes
const { data: todo, isLoading, update } = useCoState<Todo>(
  'todos',
  () => props.todoId
)

async function toggleComplete() {
  await update({ completed: !todo.value?.completed })
}
</script>

<template>
  <div v-if="isLoading" class="animate-pulse">Loading...</div>
  <label v-else-if="todo" class="flex items-center gap-2">
    <input
      type="checkbox"
      :checked="todo.completed"
      @change="toggleComplete"
    />
    {{ todo.text }}
  </label>
</template>
```

### 4.3 Collection Composable Usage

```vue
<!-- components/TodoList.vue -->
<script setup lang="ts">
import { useCoList } from '~/composables/useCoState'
import type { Todo } from '~/types'

// Get all non-deleted todos
const { items: todos, isLoading } = useCoList<Todo>('todos', {
  where: (todo) => !todo.deleted
})
</script>

<template>
  <div v-if="isLoading">Loading todos...</div>
  <ul v-else>
    <li v-for="todo in todos" :key="todo.id">
      <TodoItem :todo-id="todo.id" />
    </li>
  </ul>
</template>
```

### 4.4 Patterns Adopted

| Source | Pattern | Why We Use It |
|--------|---------|---------------|
| **VueUse** | `createInjectionState` | Clean provider/consumer, auto Symbol key |
| **VueUse** | `useOnline` | Reactive network status, auto-cleanup |
| **VueUse** | `useWebSocket` | Auto-reconnect, heartbeat, clean API |
| **VueUse** | `useDebounceFn` | Batched writes (200ms like Jazz) |
| **VueUse** | `useAsyncState` | Loading/error handling built-in |
| **VueUse** | `useSupported` | SSR-safe feature detection |
| **Jazz** | `shallowRef` for DB objects | Prevents deep reactivity on IDB |
| **Jazz** | Request queue | Prevents transaction auto-commit |
| **Vue** | `readonly()` on returns | Prevent accidental direct mutation |

---

## Part 5: File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `app/composables/useSyncEngine.ts` | **Create** | Provider/consumer with VueUse integration |
| `app/composables/useCoState.ts` | **Create** | Entity composable with useAsyncState |
| `app/composables/useCoList.ts` | **Create** | Collection composable |
| `app/composables/useIndexedDB.ts` | **Create** | Core IndexedDB operations |
| `app/composables/useUnsyncedTracker.ts` | **Create** | Server-only sync tracking |
| `app/composables/useSessionTracking.ts` | **Create** | Session-based operations |
| `app/composables/useStorageQuota.ts` | **Create** | Quota monitoring with useSupported |
| `app/utils/idb-transaction-queue.ts` | **Create** | Request queuing (Jazz pattern) |
| `app/utils/idb-helpers.ts` | **Create** | IndexedDB promise wrappers |
| `app/utils/entity-cache.ts` | **Create** | In-memory caching layer |
| `app/composables/useLocalDatabase.ts` | **Delete** | Replaced by useSyncEngine |
| `nuxt.config.ts` | **Simplify** | Remove COOP/COEP headers |
| `package.json` | **Modify** | Remove `sql.js`, add VueUse if not present |
| `public/wasm/*` | **Delete** | No longer needed |

---

## Part 6: Benefits Summary

| Benefit | Impact |
|---------|--------|
| **~200KB smaller bundle** | No WASM overhead |
| **Faster startup** | No WASM parsing (~500ms saved) |
| **Simpler deployment** | No COOP/COEP headers required |
| **Native object storage** | No JSON serialization overhead |
| **Automatic persistence** | No explicit `persistDatabase()` calls |
| **Browser-managed quota** | 50MB+ per origin, automatic eviction |
| **Session-based operations** | Full conflict visibility from day one |
| **Resumable sync** | Track what server needs after reconnection |
| **VueUse integration** | Cleaner code, auto-cleanup, battle-tested |

---

## Part 7: Key Patterns Summary

1. **Request Queuing** - Prevent IndexedDB transaction auto-commit
2. **Batched Persistence** - 200ms debounce for sync state updates
3. **Session-Based Ordering** - Preserve all operations, enable conflict resolution
4. **In-Memory Caching** - Skip IDB reads for recently accessed items
5. **Composite Keys** - `[sessionId, idx]` for ordered operations
6. **Relaxed Durability** - Faster writes for non-critical data
7. **VueUse Composables** - Replace manual event handling, network detection

---

## Part 8: Testing Strategy

### 8.1 Test Infrastructure

We use **Vitest browser mode** with real IndexedDB for accurate testing.

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Browser mode for IndexedDB tests
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
      headless: true,
    },
    include: ['**/*.browser.test.ts'],
  },
})
```

### 8.2 IndexedDB Test Utilities

```typescript
// tests/utils/idb-test-utils.ts
export async function createTestDB(): Promise<IDBDatabase> {
  const dbName = `test-db-${Date.now()}-${Math.random()}`
  // Create fresh DB for each test
  return initIndexedDB(dbName)
}

export async function cleanupTestDB(db: IDBDatabase): Promise<void> {
  db.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(db.name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export function withTestDB() {
  let db: IDBDatabase

  beforeEach(async () => {
    db = await createTestDB()
  })

  afterEach(async () => {
    await cleanupTestDB(db)
  })

  return () => db
}
```

### 8.3 Unit Tests (Browser Mode)

```typescript
// tests/composables/useCoState.browser.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { withTestDB } from '../utils/idb-test-utils'
import { useCoState } from '~/composables/useCoState'

describe('useCoState', () => {
  const getDB = withTestDB()

  it('loads entity from IndexedDB', async () => {
    const db = getDB()

    // Seed test data
    const tx = db.transaction('todos', 'readwrite')
    tx.objectStore('todos').add({
      id: 'todo-1',
      text: 'Test todo',
      completed: false,
      updatedAt: Date.now(),
    })
    await new Promise((r) => (tx.oncomplete = r))

    // Test composable
    const { data, isLoading } = useCoState('todos', 'todo-1')

    // Wait for loading
    await vi.waitFor(() => !isLoading.value)

    expect(data.value).toMatchObject({
      id: 'todo-1',
      text: 'Test todo',
    })
  })

  it('updates entity optimistically', async () => {
    const db = getDB()

    // Seed
    const tx = db.transaction('todos', 'readwrite')
    tx.objectStore('todos').add({
      id: 'todo-1',
      text: 'Original',
      completed: false,
      updatedAt: Date.now(),
    })
    await new Promise((r) => (tx.oncomplete = r))

    const { data, update } = useCoState('todos', 'todo-1')
    await vi.waitFor(() => data.value !== null)

    // Update
    await update({ text: 'Updated' })

    // Optimistic update should be immediate
    expect(data.value?.text).toBe('Updated')

    // Verify persisted to IDB
    const readTx = db.transaction('todos', 'readonly')
    const stored = await promisify(
      readTx.objectStore('todos').get('todo-1')
    )
    expect(stored.text).toBe('Updated')
  })
})
```

### 8.4 Session Tracking Tests

```typescript
// tests/composables/useSessionTracking.browser.test.ts
describe('useSessionTracking', () => {
  const getDB = withTestDB()

  it('records operations in sequence', async () => {
    const db = getDB()
    const { recordOperation, getKnownState } = useSessionTracking(
      ref(db),
      'device-1'
    )

    await recordOperation('todos', 'todo-1', 'create', { text: 'First' })
    await recordOperation('todos', 'todo-1', 'update', { text: 'Second' })

    const knownState = await getKnownState('todos', 'todo-1')

    // Should have one session with 2 operations
    const sessionIds = Object.keys(knownState)
    expect(sessionIds).toHaveLength(1)
    expect(knownState[sessionIds[0]]).toBe(2)
  })

  it('creates separate sessions per device', async () => {
    const db = getDB()
    const tracker1 = useSessionTracking(ref(db), 'device-1')
    const tracker2 = useSessionTracking(ref(db), 'device-2')

    await tracker1.recordOperation('todos', 'todo-1', 'update', { a: 1 })
    await tracker2.recordOperation('todos', 'todo-1', 'update', { b: 2 })

    const knownState = await tracker1.getKnownState('todos', 'todo-1')

    // Should have two sessions
    expect(Object.keys(knownState)).toHaveLength(2)
  })
})
```

### 8.5 Sync Tracking Tests

```typescript
// tests/composables/useUnsyncedTracker.browser.test.ts
describe('useUnsyncedTracker', () => {
  const getDB = withTestDB()

  it('batches unsynced updates', async () => {
    const db = getDB()
    const { markUnsynced, getUnsyncedIds, flush } = useUnsyncedTracker(ref(db))

    // Mark multiple items
    markUnsynced('todo-1')
    markUnsynced('todo-2')
    markUnsynced('todo-3')

    // Force flush (skip debounce)
    await flush()

    const unsynced = await getUnsyncedIds()
    expect(unsynced).toHaveLength(3)
    expect(unsynced).toContain('todo-1')
  })

  it('removes synced items', async () => {
    const db = getDB()
    const { markUnsynced, markSynced, getUnsyncedIds, flush } =
      useUnsyncedTracker(ref(db))

    markUnsynced('todo-1')
    await flush()

    markSynced('todo-1')
    await flush()

    const unsynced = await getUnsyncedIds()
    expect(unsynced).toHaveLength(0)
  })
})
```

### 8.6 Component Tests

```typescript
// tests/components/TodoItem.browser.test.ts
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TodoItem from '~/components/TodoItem.vue'

describe('TodoItem', () => {
  const getDB = withTestDB()

  it('renders todo text', async () => {
    const db = getDB()

    // Seed data
    const tx = db.transaction('todos', 'readwrite')
    tx.objectStore('todos').add({
      id: 'todo-1',
      text: 'Buy groceries',
      completed: false,
      updatedAt: Date.now(),
    })
    await new Promise((r) => (tx.oncomplete = r))

    // Mount with provider
    const wrapper = mount(TodoItem, {
      props: { todoId: 'todo-1' },
      global: {
        provide: {
          [SyncEngineSymbol]: createMockSyncEngine(db),
        },
      },
    })

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Buy groceries')
    })
  })

  it('toggles completion on checkbox click', async () => {
    // Similar setup...
    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.trigger('change')

    // Verify optimistic update
    expect(wrapper.find('input').element.checked).toBe(true)
  })
})
```

### 8.7 Test Categories

| Category | Location | Runner |
|----------|----------|--------|
| IndexedDB operations | `tests/**/*.browser.test.ts` | Vitest browser mode |
| Composables | `tests/composables/*.browser.test.ts` | Vitest browser mode |
| Components | `tests/components/*.browser.test.ts` | Vitest browser mode |
| Sync protocol | `tests/sync/*.test.ts` | Vitest (Node) |
| Server endpoints | `server/**/*.test.ts` | Vitest (Node) |

---

## Part 9: Error Handling & Edge Cases

### 9.1 QuotaExceededError

When IndexedDB storage quota is exceeded:

```typescript
// app/utils/idb-error-handling.ts
export async function safeIDBOperation<T>(
  operation: () => Promise<T>,
  options: { onQuotaExceeded?: () => void } = {}
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === 'QuotaExceededError'
    ) {
      console.error('Storage quota exceeded')

      // Notify user
      options.onQuotaExceeded?.()

      // Attempt cleanup
      await cleanupOldData()

      // Retry once
      return operation()
    }
    throw error
  }
}

async function cleanupOldData(): Promise<void> {
  // Delete soft-deleted items older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000

  const db = await getDB()
  const tx = db.transaction(['todos', 'projects'], 'readwrite')

  for (const storeName of ['todos', 'projects']) {
    const store = tx.objectStore(storeName)
    const index = store.index('by_deleted')
    const cursor = index.openCursor(IDBKeyRange.only(true))

    cursor.onsuccess = () => {
      const c = cursor.result
      if (c) {
        if (c.value.updatedAt < cutoff) {
          c.delete()
        }
        c.continue()
      }
    }
  }
}
```

### 9.2 Corrupted Data Recovery

```typescript
// app/utils/data-recovery.ts
export async function validateAndRepair(
  db: IDBDatabase
): Promise<{ repaired: number; errors: string[] }> {
  const errors: string[] = []
  let repaired = 0

  for (const storeName of ['todos', 'projects']) {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const all = await promisify(store.getAll())

    for (const item of all) {
      const issues = validateItem(item)

      if (issues.length > 0) {
        errors.push(`${storeName}/${item.id}: ${issues.join(', ')}`)

        // Attempt repair
        const repairedItem = repairItem(item, issues)
        if (repairedItem) {
          store.put(repairedItem)
          repaired++
        } else {
          // Mark as corrupted, don't sync
          store.put({ ...item, _corrupted: true })
        }
      }
    }
  }

  return { repaired, errors }
}

function validateItem(item: unknown): string[] {
  const issues: string[] = []

  if (!item || typeof item !== 'object') {
    issues.push('not an object')
    return issues
  }

  const obj = item as Record<string, unknown>

  if (typeof obj.id !== 'string') issues.push('missing id')
  if (typeof obj.updatedAt !== 'number') issues.push('invalid updatedAt')

  return issues
}

function repairItem(
  item: Record<string, unknown>,
  issues: string[]
): Record<string, unknown> | null {
  const repaired = { ...item }

  for (const issue of issues) {
    if (issue === 'invalid updatedAt') {
      repaired.updatedAt = Date.now()
    }
    // Cannot repair missing id
    if (issue === 'missing id') return null
  }

  return repaired
}
```

### 9.3 Version Upgrade Conflicts

```typescript
// app/composables/useIndexedDB.ts
request.onupgradeneeded = (event) => {
  const db = request.result
  const oldVersion = event.oldVersion
  const newVersion = event.newVersion ?? DB_VERSION

  console.log(`Upgrading IndexedDB from v${oldVersion} to v${newVersion}`)

  // Version-specific migrations
  if (oldVersion < 1) {
    // Initial schema (already defined above)
  }

  if (oldVersion < 2) {
    // Future: Add new store
    // if (!db.objectStoreNames.contains('newStore')) {
    //   db.createObjectStore('newStore', { keyPath: 'id' })
    // }
  }
}

request.onblocked = () => {
  // Another tab has the database open
  console.warn('Database upgrade blocked - close other tabs')

  // Notify user
  showNotification({
    title: 'Update Required',
    message: 'Please close other tabs to complete the update.',
    type: 'warning',
  })
}
```

### 9.4 Network Error Recovery

```typescript
// app/composables/useSyncReconnection.ts
import { useWebSocket, useOnline, whenever } from '@vueuse/core'

export function useSyncReconnection(options: { peer: string }) {
  const isOnline = useOnline()
  const syncError = ref<Error | null>(null)
  const retryCount = ref(0)
  const maxRetries = 5

  const { status, send, open, close } = useWebSocket(options.peer, {
    autoReconnect: {
      retries: maxRetries,
      delay: 1000,
      maxDelay: 30000,
      onFailed() {
        syncError.value = new Error(
          `Failed to connect after ${maxRetries} attempts`
        )
      },
    },
    onConnected() {
      syncError.value = null
      retryCount.value = 0
    },
    onError(ws, event) {
      retryCount.value++
      console.error('WebSocket error:', event)
    },
  })

  // Manual retry
  function retry() {
    syncError.value = null
    retryCount.value = 0
    open()
  }

  // Auto-retry when coming back online
  whenever(
    () => isOnline.value && status.value === 'CLOSED',
    () => {
      retry()
    }
  )

  return {
    status,
    send,
    syncError: readonly(syncError),
    retryCount: readonly(retryCount),
    retry,
  }
}
```

### 9.5 User Feedback Patterns

```typescript
// app/composables/useSyncStatus.ts
export function useSyncStatus() {
  const { wsStatus, syncError } = useSyncReconnection()
  const { getUnsyncedCount } = useUnsyncedTracker()
  const { isLowStorage } = useStorageQuota()

  const unsyncedCount = ref(0)

  // Poll unsynced count
  useIntervalFn(async () => {
    unsyncedCount.value = await getUnsyncedCount()
  }, 5000)

  const statusMessage = computed(() => {
    if (syncError.value) {
      return { type: 'error', message: 'Sync failed. Click to retry.' }
    }
    if (!navigator.onLine) {
      return { type: 'offline', message: 'Offline - changes saved locally' }
    }
    if (wsStatus.value === 'CONNECTING') {
      return { type: 'connecting', message: 'Connecting...' }
    }
    if (unsyncedCount.value > 0) {
      return {
        type: 'syncing',
        message: `Syncing ${unsyncedCount.value} changes...`,
      }
    }
    if (isLowStorage.value) {
      return { type: 'warning', message: 'Storage almost full' }
    }
    return { type: 'synced', message: 'All changes saved' }
  })

  return { statusMessage, unsyncedCount }
}
```

### 9.6 Error Scenarios Summary

| Scenario | Detection | Recovery | User Feedback |
|----------|-----------|----------|---------------|
| **Quota exceeded** | `QuotaExceededError` | Cleanup old data, retry | "Storage full - cleaning up..." |
| **Corrupted data** | Validation on load | Repair or mark corrupted | "Some data was recovered" |
| **Version conflict** | `onblocked` event | Wait for other tabs | "Close other tabs to update" |
| **Network error** | WebSocket error | Auto-retry with backoff | "Reconnecting..." |
| **Server unreachable** | Max retries exceeded | Manual retry button | "Sync failed. Click to retry" |
| **Offline** | `useOnline` | Queue changes locally | "Offline - changes saved locally" |

---

## Part 10: IndexedDB Best Practices

### Storage Quotas by Browser

| Browser | Quota |
|---------|-------|
| Chrome/Edge | 60% of disk (e.g., 600GB on 1TB) |
| Firefox | 10% or 10GB; 50% with persistent storage |
| Safari | 60% for browser apps; 15% for others |

### Performance Tips

1. **Batch operations** - Single transaction for multiple writes (10-100x faster)
2. **Use relaxed durability** - `{ durability: 'relaxed' }` for non-critical data
3. **Create indexes** - On frequently queried fields
4. **Keep records small** - Large objects block main thread during cloning
5. **Use Web Workers** - For heavy operations (future enhancement)

### Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| One transaction per operation | Batch into single transaction |
| Async operations in transactions | Fetch data first, then transact |
| Large nested objects | Denormalize into smaller records |
| Safari 7-day purge | Request persistent storage |
| No error handling | Always catch `QuotaExceededError` |

---

## References

### Vue 3 & VueUse (Primary)
- [VueUse Documentation](https://vueuse.org/)
- [createInjectionState](https://vueuse.org/shared/createinjectionstate/)
- [useOnline](https://vueuse.org/core/useOnline/)
- [useWebSocket](https://vueuse.org/core/useWebSocket/)
- [useAsyncState](https://vueuse.org/core/useAsyncState/)
- [useDebounceFn](https://vueuse.org/shared/useDebounceFn/)
- [useSupported](https://vueuse.org/core/useSupported/)

### Testing
- [Vitest Browser Mode](https://vitest.dev/guide/browser/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Playwright](https://playwright.dev/)

### IndexedDB & Jazz
- Jazz source code: `jazz/packages/cojson-storage-indexeddb/`
- [MDN IndexedDB Guide](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [RxDB IndexedDB Best Practices](https://rxdb.info/slow-indexeddb.html)
