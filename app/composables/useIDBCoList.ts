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
 * const { items, isLoading, refresh, create, remove } = useCoList<TodoData>('todos', {
 *   where: (item) => !item.completed
 * })
 *
 * // Create a new todo
 * const todo = await create({ text: 'Buy groceries', completed: false })
 *
 * // Remove a todo (soft delete)
 * await remove('todo-123')
 * ```
 */

import type { Ref } from 'vue'
import type { SyncItem } from '../../shared/types'
import { useAsyncState } from '@vueuse/core'
import { entityToSyncData, getAllRecords, getRecord, putRecord, syncItemToEntity } from '~/utils/idb-helpers'
import { txQueue } from '~/utils/idb-transaction-queue'
import { useIDBSyncEngine } from './useIDBSyncEngine'

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
  /** Create a new item in the collection */
  create: (data: Omit<T, 'id'>) => Promise<Omit<T, 'id'> & { id: string }>
  /** Remove an item from the collection (soft delete) */
  remove: (id: string) => Promise<void>
  /** Update an item in the collection */
  update: (id: string, changes: Partial<Omit<T, 'id'>>) => Promise<void>
}

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
  const { db, isReady, deviceId, markUnsynced, recordOperation, broadcastChange, onCrossTabChange } = useIDBSyncEngine()
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
  const error = computed(() => toError(rawError.value))

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

  // Cross-Tab Sync Subscription
  onMounted(() => {
    const unsubscribe = onCrossTabChange((change) => {
      // Only refresh if the change is for this collection
      if (change.collection === collection) {
        execute()
      }
    })

    onUnmounted(unsubscribe)
  })

  /**
   * Refresh data from IndexedDB.
   */
  async function refresh(): Promise<void> {
    await execute()
  }

  /**
   * Create a new item in the collection.
   */
  async function create(data: Omit<T, 'id'>): Promise<Omit<T, 'id'> & { id: string }> {
    const database = db.value

    if (!database) {
      throw new Error('[useCoList] Database not initialized')
    }

    const now = Date.now()
    const id = crypto.randomUUID()

    // Create the entity with id - explicit type annotation avoids assertion
    const entity: Omit<T, 'id'> & { id: string } = { id, ...data }

    // Create the SyncItem for storage
    const syncItem: SyncItem = {
      id,
      data: entityToSyncData(entity),
      createdAt: now,
      updatedAt: now,
      deviceId: deviceId.value,
      deleted: false,
    }

    await txQueue.enqueue(
      database,
      [collection],
      'readwrite',
      async (tx) => {
        const store = tx.objectStore(collection)
        await putRecord(store, syncItem)
      },
    )

    // Mark as unsynced and record the operation
    markUnsynced(id)
    await recordOperation(collection, id, 'create', entityToSyncData(entity))

    // Refresh the list to include the new item
    await refresh()

    // Notify other tabs about the change
    broadcastChange({ type: 'entity_changed', collection, entityId: id, operation: 'create' })

    return entity
  }

  /**
   * Remove an item from the collection (soft delete).
   */
  async function remove(id: string): Promise<void> {
    const database = db.value

    if (!database) {
      throw new Error('[useCoList] Database not initialized')
    }

    const now = Date.now()

    await txQueue.enqueue(
      database,
      [collection],
      'readwrite',
      async (tx) => {
        const store = tx.objectStore(collection)
        const existingItem = await getRecord<SyncItem>(store, id)

        if (!existingItem) {
          throw new Error(`[useCoList] Item not found: ${id}`)
        }

        // Soft delete - mark as deleted
        const updatedItem: SyncItem = {
          ...existingItem,
          deleted: true,
          updatedAt: now,
          deviceId: deviceId.value,
        }

        await putRecord(store, updatedItem)
      },
    )

    // Mark as unsynced and record the operation
    markUnsynced(id)
    await recordOperation(collection, id, 'delete', { deleted: true })

    // Refresh the list to remove the item
    await refresh()

    // Notify other tabs about the change
    broadcastChange({ type: 'entity_changed', collection, entityId: id, operation: 'delete' })
  }

  /**
   * Update an item in the collection.
   */
  async function update(id: string, changes: Partial<Omit<T, 'id'>>): Promise<void> {
    const database = db.value

    if (!database) {
      throw new Error('[useCoList] Database not initialized')
    }

    const now = Date.now()

    await txQueue.enqueue(
      database,
      [collection],
      'readwrite',
      async (tx) => {
        const store = tx.objectStore(collection)
        const existingItem = await getRecord<SyncItem>(store, id)

        if (!existingItem) {
          throw new Error(`[useCoList] Item not found: ${id}`)
        }

        // Merge changes into existing data
        const updatedItem: SyncItem = {
          ...existingItem,
          data: {
            ...existingItem.data,
            ...changes,
          },
          updatedAt: now,
          deviceId: deviceId.value,
        }

        await putRecord(store, updatedItem)
      },
    )

    // Mark as unsynced and record the operation
    markUnsynced(id)
    await recordOperation(collection, id, 'update', { ...changes })

    // Refresh the list to show the update
    await refresh()

    // Notify other tabs about the change
    broadcastChange({ type: 'entity_changed', collection, entityId: id, operation: 'update' })
  }

  // Return refs directly - useAsyncState already manages mutability
  // The consumer should treat these as read-only per the interface contract
  return {
    items,
    isLoading,
    error,
    refresh,
    create,
    remove,
    update,
  }
}
