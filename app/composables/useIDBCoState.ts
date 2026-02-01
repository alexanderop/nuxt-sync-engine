/**
 * useCoState Composable (IndexedDB Version)
 * ==========================================
 *
 * Single entity state management using IndexedDB.
 * Uses VueUse's useAsyncState for async loading with automatic loading/error states.
 *
 * > **VueUse Integration**
 * >
 * > - useAsyncState for async loading with built-in isLoading/error refs
 * > - toValue for unwrapping MaybeRefOrGetter
 * > - readonly for preventing mutations to returned refs
 *
 * @example
 * ```typescript
 * const { data, isLoading, error, update, refresh } = useCoState<TodoData>(
 *   'todos',
 *   () => props.todoId
 * )
 *
 * // Update the todo
 * await update({ completed: true })
 * ```
 */

import type { MaybeRefOrGetter, Ref } from 'vue'
import type { SyncItem } from '../../shared/types'
import { useAsyncState } from '@vueuse/core'
import { entityToSyncData, getRecord, partialToChanges, putRecord, syncItemToEntity } from '~/utils/idb-helpers'
import { txQueue } from '~/utils/idb-transaction-queue'
import { useIDBSyncEngine } from './useIDBSyncEngine'

/**
 * Return type for the useCoState composable.
 */
export interface UseCoStateReturn<T extends { id: string }> {
  /** The current data (null if loading/not-found) */
  data: Ref<T | null>
  /** Whether data is currently being loaded */
  isLoading: Ref<boolean>
  /** Error if loading failed */
  error: Ref<Error | null>
  /** Update the entity with partial changes */
  update: (changes: Partial<T>) => Promise<void>
  /** Refresh data from IndexedDB */
  refresh: () => Promise<void>
}

/**
 * Subscribe to a single entity by ID from IndexedDB.
 *
 * @param collection - The collection/store name (e.g., 'todos')
 * @param id - The entity ID (can be a ref, getter, or plain value)
 *
 * @example
 * ```typescript
 * // With a getter (reactive to route params)
 * const { data, isLoading, update } = useCoState<TodoData>('todos', () => route.params.id)
 *
 * // With a plain value
 * const { data } = useCoState<TodoData>('todos', 'todo-123')
 *
 * // Update the entity
 * await update({ completed: true })
 * ```
 */
export function useCoState<T extends { id: string }>(
  collection: string,
  id: MaybeRefOrGetter<string | null | undefined>,
): UseCoStateReturn<T> {
  const { db, markUnsynced, recordOperation, isReady } = useIDBSyncEngine()

  /**
   * Load entity from IndexedDB.
   */
  async function loadEntity(): Promise<T | null> {
    const currentId = toValue(id)
    const database = db.value

    if (!currentId || !database) {
      return null
    }

    const tx = database.transaction(collection, 'readonly')
    const store = tx.objectStore(collection)
    const item = await getRecord<SyncItem>(store, currentId)

    if (!item || item.deleted) {
      return null
    }

    // Return the data with id merged in using typed helper
    return syncItemToEntity<T>(item)
  }

  // Initial state - using a function to avoid type assertions
  const initialState: T | null = null

  // Use VueUse's useAsyncState for async loading with built-in loading/error states
  // Using shallow: true (default) for better performance - state is replaced on each load
  const {
    state: data,
    isLoading,
    error: rawError,
    execute,
  } = useAsyncState(
    loadEntity,
    initialState,
    {
      immediate: false, // We'll trigger manually when ready
      resetOnExecute: false, // Keep old data while refreshing
    },
  )

  // Transform error to proper Error type
  const error = computed(() => toError(rawError.value))

  // Watch for database ready and id changes
  watch(
    [() => isReady.value, () => toValue(id)],
    async ([ready, currentId]) => {
      if (ready && currentId) {
        await execute()
      }
      else if (!currentId) {
        // Clear data when id becomes null/undefined
        data.value = null
      }
    },
    { immediate: true },
  )

  /**
   * Update the entity with partial changes.
   * Applies optimistic update, then persists to IndexedDB.
   */
  async function update(changes: Partial<T>): Promise<void> {
    const currentId = toValue(id)
    const database = db.value

    if (!currentId || !database || !data.value) {
      throw new Error('[useCoState] Cannot update: entity not loaded')
    }

    // Create updated data with timestamp
    const now = Date.now()
    const updatedData = {
      ...data.value,
      ...changes,
    }

    // Apply optimistic update
    data.value = updatedData

    // Create the SyncItem for storage
    await txQueue.enqueue(
      database,
      [collection],
      'readwrite',
      async (tx) => {
        const store = tx.objectStore(collection)

        // Get existing item to preserve metadata
        const existingItem = await getRecord<SyncItem>(store, currentId)

        const syncItem: SyncItem = {
          id: currentId,
          data: entityToSyncData(updatedData),
          createdAt: existingItem?.createdAt ?? now,
          updatedAt: now,
          deviceId: existingItem?.deviceId ?? '',
          deleted: false,
        }

        await putRecord(store, syncItem)
      },
    )

    // Mark as unsynced and record the operation
    markUnsynced(currentId)
    await recordOperation(collection, currentId, 'update', partialToChanges(changes))
  }

  /**
   * Refresh data from IndexedDB.
   */
  async function refresh(): Promise<void> {
    await execute()
  }

  // Return refs directly - useAsyncState already manages mutability
  // The consumer should treat these as read-only per the interface contract
  return {
    data,
    isLoading,
    error,
    update,
    refresh,
  }
}
