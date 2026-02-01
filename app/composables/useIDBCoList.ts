/**
 * useCoList Composable (IndexedDB Version)
 * =========================================
 *
 * Collection management using IndexedDB.
 * Uses VueUse's useAsyncState for async loading with automatic loading/error states.
 *
 * > **VueUse Integration**
 * >
 * > - useAsyncState for async loading with built-in isLoading/error refs
 * > - readonly for preventing mutations to returned refs
 *
 * @example
 * ```typescript
 * const { items, isLoading, refresh } = useCoList<TodoData>('todos', {
 *   where: (item) => !item.completed
 * })
 * ```
 */

import type { Ref } from 'vue'
import type { SyncItem } from '../../shared/types'
import { useAsyncState } from '@vueuse/core'
import { getAllRecords, syncItemToEntity } from '~/utils/idb-helpers'
import { useIDBSyncEngine } from './useIDBSyncEngine'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Options for the useCoList composable.
 */
export interface UseCoListOptions<T> {
  /** Filter function to apply to items */
  where?: (item: T) => boolean
}

/**
 * Return type for the useCoList composable.
 */
export interface UseCoListReturn<T extends { id: string }> {
  /** The list of items */
  items: Ref<T[]>
  /** Whether data is currently being loaded */
  isLoading: Ref<boolean>
  /** Error if loading failed */
  error: Ref<Error | null>
  /** Refresh data from IndexedDB */
  refresh: () => Promise<void>
}

// =============================================================================
// COMPOSABLE
// =============================================================================

/**
 * Subscribe to all items in a collection from IndexedDB.
 *
 * @param collection - The collection/store name (e.g., 'todos')
 * @param options - Optional configuration including filter function
 *
 * @example
 * ```typescript
 * // Get all todos
 * const { items, isLoading } = useCoList<TodoData>('todos')
 *
 * // Get only incomplete todos
 * const { items } = useCoList<TodoData>('todos', {
 *   where: (todo) => !todo.completed
 * })
 *
 * // Refresh the list
 * await refresh()
 * ```
 */
export function useCoList<T extends { id: string }>(
  collection: string,
  options: UseCoListOptions<T> = {},
): UseCoListReturn<T> {
  const { db, isReady } = useIDBSyncEngine()
  const { where } = options

  /**
   * Load all items from IndexedDB.
   */
  async function loadItems(): Promise<T[]> {
    const database = db.value

    if (!database) {
      return []
    }

    const tx = database.transaction(collection, 'readonly')
    const store = tx.objectStore(collection)
    const syncItems = await getAllRecords<SyncItem>(store)

    // Filter out deleted items and transform to T using typed helper
    let items = syncItems
      .filter(item => !item.deleted)
      .map(item => syncItemToEntity<T>(item))

    // Apply where filter if provided
    if (where) {
      items = items.filter(where)
    }

    return items
  }

  // Initial state - using a typed variable to avoid type assertions
  const initialState: T[] = []

  // Use VueUse's useAsyncState for async loading with built-in loading/error states
  // Using shallow: true (default) for better performance - state is replaced on each load
  const {
    state: items,
    isLoading,
    error: rawError,
    execute,
  } = useAsyncState(
    loadItems,
    initialState,
    {
      immediate: false, // We'll trigger manually when ready
      resetOnExecute: false, // Keep old data while refreshing
    },
  )

  // Transform error to proper Error type
  const error = computed<Error | null>(() => {
    const err = rawError.value
    if (!err)
      return null
    if (err instanceof Error)
      return err
    return new Error(String(err))
  })

  // Watch for database ready state
  watch(
    () => isReady.value,
    async (ready) => {
      if (ready) {
        await execute()
      }
    },
    { immediate: true },
  )

  /**
   * Refresh data from IndexedDB.
   */
  async function refresh(): Promise<void> {
    await execute()
  }

  // Return refs directly - useAsyncState already manages mutability
  // The consumer should treat these as read-only per the interface contract
  return {
    items,
    isLoading,
    error,
    refresh,
  }
}
