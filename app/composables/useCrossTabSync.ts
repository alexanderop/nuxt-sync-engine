/**
 * Cross-Tab Sync Composable
 * ==========================
 *
 * Enables real-time synchronization between browser tabs using the BroadcastChannel API.
 * When a tab makes changes to IndexedDB, it broadcasts a message to notify other tabs,
 * which then refresh their data.
 *
 * > **VueUse Integration**
 * >
 * > - useBroadcastChannel for cross-tab communication
 *
 * @example
 * ```typescript
 * const { broadcast, onMessage, isSupported } = useCrossTabSync('my-tab-id')
 *
 * // Broadcast a change to other tabs
 * broadcast({ type: 'entity_changed', collection: 'todos', entityId: '123', operation: 'create' })
 *
 * // Listen for changes from other tabs
 * const unsubscribe = onMessage((change) => {
 *   if (change.collection === 'todos') {
 *     refresh()
 *   }
 * })
 * ```
 */

import type { Ref } from 'vue'
import { useBroadcastChannel } from '@vueuse/core'

// =============================================================================
// CONSTANTS
// =============================================================================

const CHANNEL_NAME = 'sync-engine-cross-tab'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Message structure for cross-tab sync notifications.
 */
export interface CrossTabChange {
  /** The type of change notification */
  type: 'entity_changed'
  /** The collection/store name (e.g., 'todos') */
  collection: string
  /** The entity ID that changed */
  entityId: string
  /** The type of operation performed */
  operation: 'create' | 'update' | 'delete'
  /** The tab ID that originated this change */
  sourceTabId: string
  /** Timestamp when the change occurred */
  timestamp: number
}

/**
 * Return type for the useCrossTabSync composable.
 */
export interface UseCrossTabSyncReturn {
  /** Whether BroadcastChannel is supported in this browser */
  isSupported: Ref<boolean>
  /** Broadcast a change to other tabs */
  broadcast: (change: Omit<CrossTabChange, 'sourceTabId' | 'timestamp'>) => void
  /** Subscribe to changes from other tabs. Returns unsubscribe function. */
  onMessage: (callback: (change: CrossTabChange) => void) => () => void
}

// =============================================================================
// COMPOSABLE
// =============================================================================

/**
 * Cross-tab synchronization using BroadcastChannel.
 *
 * @param tabId - Unique identifier for this tab (used to filter out own messages)
 *
 * @example
 * ```typescript
 * const tabId = crypto.randomUUID()
 * const { broadcast, onMessage, isSupported } = useCrossTabSync(tabId)
 *
 * // After creating a todo
 * broadcast({
 *   type: 'entity_changed',
 *   collection: 'todos',
 *   entityId: newTodo.id,
 *   operation: 'create'
 * })
 *
 * // In another component, listen for changes
 * onMessage((change) => {
 *   if (change.sourceTabId !== tabId && change.collection === 'todos') {
 *     refreshTodos()
 *   }
 * })
 * ```
 */
export function useCrossTabSync(tabId: string): UseCrossTabSyncReturn {
  const { isSupported, data, post } = useBroadcastChannel<CrossTabChange, CrossTabChange>({
    name: CHANNEL_NAME,
  })

  // Store of listener callbacks
  const listeners = new Set<(change: CrossTabChange) => void>()

  // Watch for incoming messages and dispatch to listeners
  watch(data, (message) => {
    if (!message)
      return

    // Don't process our own messages
    if (message.sourceTabId === tabId)
      return

    for (const callback of listeners) callback(message)
  })

  /**
   * Broadcast a change to all other tabs.
   */
  function broadcast(change: Omit<CrossTabChange, 'sourceTabId' | 'timestamp'>): void {
    if (!isSupported.value)
      return

    const fullMessage: CrossTabChange = {
      ...change,
      sourceTabId: tabId,
      timestamp: Date.now(),
    }

    post(fullMessage)
  }

  /**
   * Subscribe to changes from other tabs.
   *
   * @param callback - Function to call when a change is received
   * @returns Unsubscribe function
   */
  function onMessage(callback: (change: CrossTabChange) => void): () => void {
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
    }
  }

  return {
    isSupported,
    broadcast,
    onMessage,
  }
}
