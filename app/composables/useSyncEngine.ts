/**
 * Sync Engine Composable
 * ======================
 *
 * Orchestrates synchronization between local database and server.
 * Implements a simplified version of Jazz's sync protocol.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's sync engine provides:
 * > - Session-based transaction ordering (not just timestamps)
 * > - Efficient KnownState exchange (only sync what's needed)
 * > - Cryptographic verification of all changes
 * > - End-to-end encryption
 * > - Automatic conflict resolution with CRDTs
 * >
 * > We use simple timestamp-based sync with last-write-wins.
 */

import type {
  SyncItem,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncState,
} from '../../shared/types'
import { useIntervalFn, useOnline } from '@vueuse/core'
import { getDeviceId } from './useDeviceId'
import {
  getChangesSince,
  getItemById,
  getLastSyncAt,
  persistDatabase,
  setLastSyncAt,
  upsertItem,
  useLocalDatabase,
} from './useLocalDatabase'

// =============================================================================
// TYPES
// =============================================================================

export interface SyncEngineOptions {
  /** Table name to sync */
  tableName: string
  /** Auto-sync interval in ms (0 to disable) */
  autoSyncInterval?: number
  /** Callback when remote changes are received */
  onRemoteChanges?: (changes: SyncItem[]) => void
}

// =============================================================================
// SYNC ENGINE COMPOSABLE
// =============================================================================

/**
 * Create a sync engine for a specific table.
 *
 * @example
 * ```typescript
 * const {
 *   sync,
 *   push,
 *   pull,
 *   state,
 * } = useSyncEngine({ tableName: 'todos' });
 *
 * // Manual sync
 * await sync();
 *
 * // Check sync state
 * if (state.value.isSyncing) {
 *   console.info('Sync in progress...');
 * }
 * ```
 */
export function useSyncEngine(options: SyncEngineOptions) {
  const { tableName, autoSyncInterval = 0, onRemoteChanges } = options

  // Sync state
  const state = ref<SyncState>({
    isSyncing: false,
    isOnline: true,
    isConnected: false,
    lastSyncAt: 0,
    error: null,
    pendingChanges: 0,
  })

  // ==========================================================================
  // ONLINE/OFFLINE DETECTION (using VueUse)
  // ==========================================================================

  const isOnline = useOnline()

  watch(isOnline, (online) => {
    state.value.isOnline = online
    if (online) {
      console.info('[sync] Back online, triggering sync...')
      sync()
    }
    else {
      console.info('[sync] Went offline')
    }
  }, { immediate: true })

  // Auto-sync interval (using VueUse)
  useIntervalFn(() => {
    if (state.value.isOnline && !state.value.isSyncing) {
      sync()
    }
  }, autoSyncInterval, { immediate: false, immediateCallback: false })

  // Load last sync timestamp on mount
  onMounted(() => {
    loadLastSyncAt()
  })

  // ==========================================================================
  // SYNC OPERATIONS
  // ==========================================================================

  async function loadLastSyncAt() {
    await useLocalDatabase()
    state.value.lastSyncAt = getLastSyncAt()
  }

  /**
   * Push local changes to the server.
   */
  async function push(): Promise<SyncPushResponse | null> {
    if (!state.value.isOnline) {
      console.info('[sync] Offline, skipping push')
      return null
    }

    const deviceId = getDeviceId()
    const changes = getChangesSince(tableName, state.value.lastSyncAt)

    if (changes.length === 0) {
      console.info('[sync] No local changes to push')
      return { syncedAt: Date.now(), conflicts: [], stored: 0 }
    }

    console.info(`[sync] Pushing ${changes.length} changes...`)

    const request: SyncPushRequest = {
      deviceId,
      schema: tableName,
      changes,
      lastSyncAt: state.value.lastSyncAt,
    }

    try {
      const response = await $fetch<SyncPushResponse>('/api/sync/push', {
        method: 'POST',
        body: request,
      })

      // Handle conflicts - server had newer versions
      if (response.conflicts.length > 0) {
        console.info(`[sync] Received ${response.conflicts.length} conflicts`)
        for (const conflict of response.conflicts) {
          applyRemoteChange(conflict)
        }
        onRemoteChanges?.(response.conflicts)
      }

      console.info(`[sync] Push complete: ${response.stored} stored, ${response.conflicts.length} conflicts`)
      return response
    }
    catch (error) {
      console.error('[sync] Push failed:', error)
      throw error
    }
  }

  /**
   * Pull remote changes from the server.
   */
  async function pull(): Promise<SyncPullResponse | null> {
    if (!state.value.isOnline) {
      console.info('[sync] Offline, skipping pull')
      return null
    }

    const deviceId = getDeviceId()

    console.info(`[sync] Pulling changes since ${state.value.lastSyncAt}...`)

    try {
      const response = await $fetch<SyncPullResponse>('/api/sync/pull', {
        query: {
          schema: tableName,
          since: state.value.lastSyncAt,
          deviceId,
        },
      })

      // Apply remote changes
      if (response.changes.length > 0) {
        console.info(`[sync] Received ${response.changes.length} remote changes`)
        for (const change of response.changes) {
          applyRemoteChange(change)
        }
        onRemoteChanges?.(response.changes)
      }

      console.info(`[sync] Pull complete: ${response.changes.length} changes`)
      return response
    }
    catch (error) {
      console.error('[sync] Pull failed:', error)
      throw error
    }
  }

  /**
   * Full sync: push then pull.
   */
  async function sync(): Promise<void> {
    if (state.value.isSyncing) {
      console.info('[sync] Sync already in progress, skipping')
      return
    }

    if (!state.value.isOnline) {
      console.info('[sync] Offline, skipping sync')
      return
    }

    state.value.isSyncing = true
    state.value.error = null

    try {
      await useLocalDatabase()

      // 1. Push local changes
      const pushResult = await push()

      // 2. Pull remote changes
      const pullResult = await pull()

      // 3. Update sync timestamp
      const syncedAt = pullResult?.syncedAt ?? pushResult?.syncedAt ?? Date.now()
      setLastSyncAt(syncedAt)
      state.value.lastSyncAt = syncedAt

      // 4. Persist database
      await persistDatabase()

      console.info('[sync] Sync complete')
    }
    catch (error) {
      state.value.error = error instanceof Error ? error.message : 'Sync failed'
      console.error('[sync] Sync failed:', error)
    }
    finally {
      state.value.isSyncing = false
    }
  }

  /**
   * Apply a remote change with conflict resolution.
   */
  function applyRemoteChange(remote: SyncItem): void {
    const local = getItemById(tableName, remote.id)

    // Apply if no local version, or remote wins conflict
    if (!local || shouldRemoteWin(remote, local)) {
      upsertItem(tableName, remote)
      console.info(`[sync] Applied remote change: ${remote.id}`)
    }
    else {
      console.info(`[sync] Local wins conflict: ${remote.id}`)
    }
  }

  /**
   * Apply changes from WebSocket (real-time sync).
   */
  function applyWebSocketChanges(changes: SyncItem[]): void {
    for (const change of changes) {
      applyRemoteChange(change)
    }
    persistDatabase()
    onRemoteChanges?.(changes)
  }

  /**
   * Update connected status (for WebSocket).
   */
  function setConnected(connected: boolean) {
    state.value.isConnected = connected
  }

  return {
    // State
    state: readonly(state),

    // Actions
    sync,
    push,
    pull,
    applyWebSocketChanges,
    setConnected,

    // Helpers
    loadLastSyncAt,
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Last-write-wins conflict resolution.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz uses:
 * > - Session-based ordering (not timestamps)
 * > - CRDT merge for concurrent edits
 * > - Explicit branching/merging for conflicts
 * >
 * > We use simple timestamp comparison.
 */
function shouldRemoteWin(remote: SyncItem, local: SyncItem): boolean {
  // Higher timestamp wins
  if (remote.updatedAt > local.updatedAt)
    return true
  if (remote.updatedAt < local.updatedAt)
    return false

  // Tiebreaker: higher device ID (deterministic)
  return remote.deviceId > local.deviceId
}

// =============================================================================
// GLOBAL SYNC ENGINE (Singleton)
// =============================================================================

let globalSyncEngine: ReturnType<typeof useSyncEngine> | null = null

/**
 * Get or create the global sync engine for todos.
 * This ensures all components share the same sync state.
 */
export function useTodoSyncEngine() {
  const config = useRuntimeConfig()
  if (!globalSyncEngine) {
    globalSyncEngine = useSyncEngine({
      tableName: 'todos',
      autoSyncInterval: config.public.syncInterval,
    })
  }
  return globalSyncEngine
}
