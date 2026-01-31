/**
 * useCoState Composable
 * =====================
 *
 * Jazz-like reactive subscription to CoValue state.
 * Provides automatic sync on mutations via Proxy.
 *
 * ```typescript
 * // Jazz API
 * const todo = useCoState(Todo, () => props.todoId);
 * todo.completed = true; // Auto-syncs!
 *
 * // Our simplified version
 * const { data, update, refresh } = useCoState('todos', () => props.todoId);
 * update({ completed: true }); // Syncs on update call
 * ```
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's useCoState provides:
 * > - True reactive Proxy with automatic sync on assignment
 * > - Loading states with depth specification
 * > - Reference resolution (nested CoValues)
 * > - Subscription to remote changes
 * > - Optimistic updates with rollback on conflict
 * >
 * > Our version is simpler but requires explicit update calls.
 */

import type { SyncItem } from '../../shared/types'
import { getDeviceId } from './useDeviceId'
import {
  getAllItems,
  getItemById,
  persistDatabase,
  upsertItem,
  useLocalDatabase,
} from './useLocalDatabase'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Loading state for CoValue.
 */
export type CoStateStatus = 'loading' | 'ready' | 'error' | 'not-found'

/**
 * Return type for useCoState.
 */
export interface CoStateResult<T extends Record<string, unknown>> {
  /** The current data (null if loading/not-found) */
  data: Ref<T | null>
  /** Current loading status */
  status: Ref<CoStateStatus>
  /** Error message if status is 'error' */
  error: Ref<string | null>
  /** The full SyncItem with metadata */
  item: Ref<SyncItem | null>
  /** Update the data */
  update: (changes: Partial<T>) => Promise<void>
  /** Refresh from database */
  refresh: () => Promise<void>
  /** Mark as deleted */
  remove: () => Promise<void>
}

/**
 * Return type for useCoStateList.
 */
export interface CoStateListResult<T extends Record<string, unknown>> {
  /** All items */
  items: Ref<Array<SyncItem & { data: T }>>
  /** Current loading status */
  status: Ref<CoStateStatus>
  /** Error message if status is 'error' */
  error: Ref<string | null>
  /** Create a new item */
  create: (data: T) => Promise<SyncItem>
  /** Update an item by ID */
  update: (id: string, changes: Partial<T>) => Promise<void>
  /** Delete an item by ID */
  remove: (id: string) => Promise<void>
  /** Refresh all items from database */
  refresh: () => Promise<void>
}

// =============================================================================
// useCoState - Single Item
// =============================================================================

/**
 * Subscribe to a single CoValue by ID.
 *
 * @example
 * ```typescript
 * // In a component
 * const { data, status, update } = useCoState<TodoData>('todos', () => props.todoId);
 *
 * // Update the todo
 * await update({ completed: true });
 * ```
 */
export function useCoState<T extends Record<string, unknown>>(
  tableName: string,
  getId: () => string | undefined,
): CoStateResult<T> {
  /* eslint-disable ts/consistent-type-assertions -- Vue ref requires explicit typing with generics */
  const data = ref<T | null>(null) as Ref<T | null>
  const status = ref<CoStateStatus>('loading') as Ref<CoStateStatus>
  const error = ref<string | null>(null) as Ref<string | null>
  const item = ref<SyncItem | null>(null) as Ref<SyncItem | null>
  /* eslint-enable ts/consistent-type-assertions */

  // Load data when ID changes
  async function load() {
    const id = getId()
    if (!id) {
      status.value = 'not-found'
      data.value = null
      item.value = null
      return
    }

    status.value = 'loading'
    error.value = null

    try {
      await useLocalDatabase()
      const result = getItemById(tableName, id)

      if (!result || result.deleted) {
        status.value = 'not-found'
        data.value = null
        item.value = null
      }
      else {
        item.value = result
        // eslint-disable-next-line ts/consistent-type-assertions -- Generic data typing
        data.value = result.data as T
        status.value = 'ready'
      }
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load'
      status.value = 'error'
    }
  }

  // Update the data
  async function update(changes: Partial<T>) {
    const id = getId()
    if (!id || !item.value) {
      throw new Error('Cannot update: item not loaded')
    }

    const deviceId = getDeviceId()
    const now = Date.now()

    // Merge changes with existing data
    const newData = { ...item.value.data, ...changes }
    const newItem: SyncItem = {
      ...item.value,
      data: newData,
      updatedAt: now,
      deviceId,
    }

    // Optimistic update
    item.value = newItem
    // eslint-disable-next-line ts/consistent-type-assertions -- Generic data typing
    data.value = newData as T

    // Persist
    try {
      upsertItem(tableName, newItem)
      await persistDatabase()
    }
    catch (e) {
      // Rollback on error
      await load()
      throw e
    }
  }

  // Refresh from database
  async function refresh() {
    await load()
  }

  // Mark as deleted
  async function remove() {
    const id = getId()
    if (!id || !item.value) {
      throw new Error('Cannot remove: item not loaded')
    }

    const deviceId = getDeviceId()
    const now = Date.now()

    const deletedItem: SyncItem = {
      ...item.value,
      deleted: true,
      updatedAt: now,
      deviceId,
    }

    // Optimistic update
    item.value = deletedItem
    data.value = null
    status.value = 'not-found'

    // Persist
    upsertItem(tableName, deletedItem)
    await persistDatabase()
  }

  // Watch for ID changes
  watch(getId, load, { immediate: true })

  return {
    data,
    status,
    error,
    item,
    update,
    refresh,
    remove,
  }
}

// =============================================================================
// useCoStateList - Multiple Items
// =============================================================================

/**
 * Subscribe to all items in a table.
 *
 * @example
 * ```typescript
 * const { items, create, update, remove } = useCoStateList<TodoData>('todos');
 *
 * // Create a new todo
 * await create({ text: 'Buy milk', completed: false });
 *
 * // Update a todo
 * await update(todoId, { completed: true });
 * ```
 */
export function useCoStateList<T extends Record<string, unknown>>(
  tableName: string,
): CoStateListResult<T> {
  /* eslint-disable ts/consistent-type-assertions -- Vue ref requires explicit typing with generics */
  const items = ref<Array<SyncItem & { data: T }>>([]) as Ref<Array<SyncItem & { data: T }>>
  const status = ref<CoStateStatus>('loading') as Ref<CoStateStatus>
  const error = ref<string | null>(null) as Ref<string | null>
  /* eslint-enable ts/consistent-type-assertions */

  // Load all items
  async function loadAll() {
    status.value = 'loading'
    error.value = null

    try {
      await useLocalDatabase()
      const results = getAllItems(tableName)
      // eslint-disable-next-line ts/consistent-type-assertions -- Generic data typing
      items.value = results as Array<SyncItem & { data: T }>
      status.value = 'ready'
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load'
      status.value = 'error'
    }
  }

  // Create a new item
  async function create(data: T): Promise<SyncItem> {
    const deviceId = getDeviceId()
    const now = Date.now()

    const newItem: SyncItem = {
      id: crypto.randomUUID(),
      data,
      createdAt: now,
      updatedAt: now,
      deviceId,
      deleted: false,
    }

    // Optimistic update
    // eslint-disable-next-line ts/consistent-type-assertions -- Generic data typing
    items.value = [newItem as SyncItem & { data: T }, ...items.value]

    // Persist
    try {
      upsertItem(tableName, newItem)
      await persistDatabase()
      return newItem
    }
    catch (e) {
      // Rollback on error
      await loadAll()
      throw e
    }
  }

  // Update an item
  async function update(id: string, changes: Partial<T>) {
    const existing = items.value.find(i => i.id === id)
    if (!existing) {
      throw new Error(`Item not found: ${id}`)
    }

    const deviceId = getDeviceId()
    const now = Date.now()

    const newItem: SyncItem & { data: T } = {
      ...existing,
      data: { ...existing.data, ...changes },
      updatedAt: now,
      deviceId,
    }

    // Optimistic update
    items.value = items.value.map(i => i.id === id ? newItem : i)

    // Persist
    try {
      upsertItem(tableName, newItem)
      await persistDatabase()
    }
    catch (e) {
      // Rollback on error
      await loadAll()
      throw e
    }
  }

  // Remove an item
  async function remove(id: string) {
    const existing = items.value.find(i => i.id === id)
    if (!existing) {
      throw new Error(`Item not found: ${id}`)
    }

    const deviceId = getDeviceId()
    const now = Date.now()

    const deletedItem: SyncItem = {
      id: existing.id,
      data: existing.data,
      createdAt: existing.createdAt,
      deleted: true,
      updatedAt: now,
      deviceId,
    }

    // Optimistic update - remove from list
    items.value = items.value.filter(i => i.id !== id)

    // Persist
    upsertItem(tableName, deletedItem)
    await persistDatabase()
  }

  // Refresh all items
  async function refresh() {
    await loadAll()
  }

  // Initial load
  onMounted(loadAll)

  return {
    items,
    status,
    error,
    create,
    update,
    remove,
    refresh,
  }
}

// =============================================================================
// PROXY-BASED REACTIVE COVALUE (Experimental)
// =============================================================================

/**
 * Create a proxy-wrapped CoValue that auto-syncs on mutation.
 * This is closer to Jazz's actual API.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's Proxy implementation:
 * > - Batches multiple mutations into single transactions
 * > - Handles nested objects and arrays
 * > - Tracks which fields changed for efficient sync
 * > - Supports undo/redo
 * >
 * > Our version is a simple proof-of-concept.
 *
 * @example
 * ```typescript
 * const todo = await createReactiveCoValue<TodoData>('todos', todoId);
 * todo.completed = true; // Auto-syncs!
 * ```
 */
export async function createReactiveCoValue<T extends Record<string, unknown>>(
  tableName: string,
  id: string,
): Promise<T & { $jazz: SyncItem }> {
  await useLocalDatabase()

  const item = getItemById(tableName, id)
  if (!item) {
    throw new Error(`Item not found: ${id}`)
  }

  const deviceId = getDeviceId()

  // Create a proxy that syncs on mutation
  /* eslint-disable ts/consistent-type-assertions -- Proxy handler requires dynamic property access */
  const handler: ProxyHandler<T & { $jazz: SyncItem }> = {
    get(target, prop) {
      if (prop === '$jazz') {
        return item
      }
      return (target as Record<string, unknown>)[prop as string]
    },

    set(target, prop, value) {
      if (prop === '$jazz') {
        return false // Don't allow setting $jazz
      }

      // Update the data
      (target as Record<string, unknown>)[prop as string] = value

      // Update metadata
      item.data[prop as string] = value
      item.updatedAt = Date.now()
      item.deviceId = deviceId

      // Persist (fire and forget for now)
      upsertItem(tableName, item)
      persistDatabase().catch(console.error)

      return true
    },
  }

  const data = { ...item.data } as T & { $jazz: SyncItem }
  /* eslint-enable ts/consistent-type-assertions */
  return new Proxy(data, handler)
}
