/**
 * Unsynced Tracker Composable
 * ===========================
 *
 * Tracks which entities need to be synced with the server.
 * Uses batched writes with debouncing (200ms) for performance.
 *
 * > **Jazz Pattern Adoption**
 * >
 * > This implementation adopts Jazz's server-only sync tracking:
 * > - Single peer (server) tracking
 * > - Batched writes for efficiency
 * > - Deduplication using unique index on entityId
 */

import type { Ref } from 'vue'
import type { UnsyncedRecord } from './useIndexedDB'
import { useDebounceFn } from '@vueuse/core'
import { getAllFromIndex, getFromIndex, promisify } from '~/utils/idb-helpers'
import { txQueue } from '~/utils/idb-transaction-queue'

interface PendingUpdate {
  id: string
  synced: boolean
}

export interface UseUnsyncedTrackerReturn {
  /** Mark an entity as needing sync */
  markUnsynced: (entityId: string) => void
  /** Mark an entity as synced (removes from unsynced store) */
  markSynced: (entityId: string) => void
  /** Get all entity IDs that need syncing */
  getUnsyncedIds: () => Promise<string[]>
  /** Get count of entities that need syncing */
  getUnsyncedCount: () => Promise<number>
  /** Force flush pending updates immediately */
  flush: () => Promise<void>
}

/**
 * Unsynced tracker composable for managing sync state.
 *
 * @param db - Reactive reference to the IndexedDB database
 *
 * @example
 * ```typescript
 * const { db, init } = useIndexedDB()
 * await init()
 *
 * const { markUnsynced, markSynced, getUnsyncedIds } = useUnsyncedTracker(db)
 *
 * // Mark entity as needing sync
 * markUnsynced('todo-123')
 *
 * // After successful sync
 * markSynced('todo-123')
 *
 * // Get all unsynced entities
 * const ids = await getUnsyncedIds()
 * ```
 */
export function useUnsyncedTracker(
  db: Ref<IDBDatabase | null>,
): UseUnsyncedTrackerReturn {
  // Pending updates to be batched
  const pendingUpdates: PendingUpdate[] = []

  /**
   * Flush pending updates to the database in a single transaction.
   * Processes all pending updates and clears the queue.
   */
  async function flushUpdates(): Promise<void> {
    const database = toValue(db)
    if (!database) {
      return
    }

    // Snapshot and clear pending updates
    const updates = pendingUpdates.splice(0, pendingUpdates.length)
    if (updates.length === 0) {
      return
    }

    await txQueue.enqueue(
      database,
      'unsynced',
      'readwrite',
      async (tx) => {
        const store = tx.objectStore('unsynced')
        const byEntityIndex = store.index('by_entity')

        for (const update of updates) {
          if (update.synced) {
            // Delete from unsynced store using the by_entity index
            const existing = await getFromIndex<UnsyncedRecord>(
              byEntityIndex,
              update.id,
            )
            if (existing && existing.rowID !== undefined) {
              await promisify(store.delete(existing.rowID))
            }
          }
          else {
            // Add to unsynced store (catch duplicate key errors)
            const record: Omit<UnsyncedRecord, 'rowID'> = {
              entityId: update.id,
              createdAt: Date.now(),
            }
            try {
              await promisify(store.add(record))
            }
            catch (error) {
              // Ignore duplicate key errors (entity already marked as unsynced)
              if (error instanceof DOMException && error.name === 'ConstraintError') {
                // Entity already in unsynced store, that's fine
                continue
              }
              throw error
            }
          }
        }
      },
    )
  }

  // Debounced version of flushUpdates (200ms delay like Jazz)
  const debouncedFlush = useDebounceFn(flushUpdates, 200)

  /**
   * Mark an entity as needing sync.
   * Uses debounced writes for batching.
   */
  function markUnsynced(entityId: string): void {
    pendingUpdates.push({ id: entityId, synced: false })
    debouncedFlush()
  }

  /**
   * Mark an entity as synced (removes from unsynced store).
   * Uses debounced writes for batching.
   */
  function markSynced(entityId: string): void {
    pendingUpdates.push({ id: entityId, synced: true })
    debouncedFlush()
  }

  /**
   * Get all entity IDs that need syncing.
   */
  async function getUnsyncedIds(): Promise<string[]> {
    const database = toValue(db)
    if (!database) {
      return []
    }

    const tx = database.transaction('unsynced', 'readonly')
    const store = tx.objectStore('unsynced')
    const byEntityIndex = store.index('by_entity')

    const records = await getAllFromIndex<UnsyncedRecord>(byEntityIndex)
    return records.map(record => record.entityId)
  }

  /**
   * Get count of entities that need syncing.
   */
  async function getUnsyncedCount(): Promise<number> {
    const database = toValue(db)
    if (!database) {
      return 0
    }

    const tx = database.transaction('unsynced', 'readonly')
    const store = tx.objectStore('unsynced')

    return promisify(store.count())
  }

  /**
   * Force flush pending updates immediately.
   * Useful for ensuring all updates are written before sync.
   */
  async function flush(): Promise<void> {
    await flushUpdates()
  }

  return {
    markUnsynced,
    markSynced,
    getUnsyncedIds,
    getUnsyncedCount,
    flush,
  }
}
