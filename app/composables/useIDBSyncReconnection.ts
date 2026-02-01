/**
 * IDB Sync Reconnection Composable
 * =================================
 *
 * WebSocket reconnection handling with auto-retry and network awareness.
 * Uses VueUse's useWebSocket for connection management and useOnline for
 * network status detection.
 *
 * > **Reconnection Strategy**
 * >
 * > - Automatic reconnection with exponential backoff
 * > - Max 5 retries before giving up
 * > - Auto-retry when coming back online after being offline
 * > - Manual retry function for user-initiated reconnection
 *
 * > **Provider Pattern**
 * >
 * > Uses VueUse's createInjectionState for provider/consumer pattern.
 * > Call useIDBSyncReconnectionProvider in a parent component,
 * > then useIDBSyncReconnection in child components.
 */

import type { Ref } from 'vue'
import { createInjectionState, useOnline, useWebSocket, whenever } from '@vueuse/core'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * WebSocket status type from VueUse.
 */
export type SyncConnectionStatus = 'OPEN' | 'CLOSED' | 'CONNECTING'

/**
 * Options for the sync reconnection composable.
 */
export interface SyncReconnectionOptions {
  /** WebSocket URL for sync server */
  peer: string
}

/**
 * Return type for the useIDBSyncReconnection composable.
 */
export interface UseIDBSyncReconnectionReturn {
  /** WebSocket connection status */
  status: Readonly<Ref<SyncConnectionStatus>>
  /** Send data through WebSocket (returns false if not connected) */
  send: (data: string | ArrayBuffer | Blob) => boolean
  /** Current sync error (null if no error) */
  syncError: Readonly<Ref<Error | null>>
  /** Number of reconnection attempts */
  retryCount: Readonly<Ref<number>>
  /** Manually trigger a reconnection attempt */
  retry: () => void
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum number of automatic reconnection attempts */
const MAX_RETRIES = 5

/** Base delay for exponential backoff (1 second) */
const BASE_DELAY_MS = 1000

/** Maximum delay between retries (30 seconds) */
const MAX_DELAY_MS = 30000

/** Injection key for the reconnection state */
const IDB_SYNC_RECONNECTION_INJECTION_KEY = Symbol('idb-sync-reconnection')

// =============================================================================
// PROVIDER COMPOSABLE
// =============================================================================

/**
 * Create the IDB Sync Reconnection provider and consumer using VueUse's createInjectionState.
 *
 * The provider initializes:
 * - WebSocket connection with auto-reconnect
 * - Network status monitoring
 * - Error tracking and retry logic
 */
const [useIDBSyncReconnectionProvider, useIDBSyncReconnectionInjected] = createInjectionState(
  (options: SyncReconnectionOptions): UseIDBSyncReconnectionReturn => {
    const { peer } = options

    // =========================================================================
    // State
    // =========================================================================

    /** Track reconnection attempts */
    const retryCount = ref(0)

    /** Track sync errors */
    const syncError = ref<Error | null>(null)

    /** Network online status */
    const isOnline = useOnline()

    // =========================================================================
    // WebSocket Connection (VueUse)
    // =========================================================================

    const {
      status,
      send: wsSend,
      open,
    } = useWebSocket(peer, {
      autoReconnect: {
        // Stop after MAX_RETRIES attempts
        retries: MAX_RETRIES,
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
        delay: (attempt: number) => {
          const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS)
          return delay
        },
        onFailed() {
          // Max retries reached, set error
          syncError.value = new Error(
            `Sync connection failed after ${MAX_RETRIES} attempts`,
          )
          console.error('[idb-sync-reconnection] Max reconnection attempts reached')
        },
      },
      immediate: true,
      onConnected() {
        // Reset error and retry count on successful connection
        syncError.value = null
        retryCount.value = 0
        console.info('[idb-sync-reconnection] Connected')
      },
      onDisconnected(_ws, event) {
        // Only log if not a clean close
        if (event.code !== 1000) {
          console.info(
            '[idb-sync-reconnection] Disconnected:',
            event.code,
            event.reason || 'No reason provided',
          )
        }
      },
      onError(_ws, _event) {
        // Increment retry count on each error
        retryCount.value++
        console.error('[idb-sync-reconnection] WebSocket error')
      },
    })

    // =========================================================================
    // Network-Aware Auto-Retry
    // =========================================================================

    // Auto-retry when coming back online and connection is closed
    whenever(
      () => isOnline.value && status.value === 'CLOSED',
      () => {
        // Only auto-retry if we have an error (meaning we previously failed)
        // or if retryCount is > 0 (meaning we were trying to connect)
        if (syncError.value || retryCount.value > 0) {
          console.info('[idb-sync-reconnection] Network online, attempting reconnect')
          retry()
        }
      },
    )

    // =========================================================================
    // Manual Retry
    // =========================================================================

    /**
     * Manually trigger a reconnection attempt.
     * Resets error state and retry count before attempting.
     */
    function retry(): void {
      // Reset state for fresh retry
      syncError.value = null
      retryCount.value = 0

      // Open new connection
      open()
      console.info('[idb-sync-reconnection] Manual retry initiated')
    }

    // =========================================================================
    // Send Wrapper
    // =========================================================================

    /**
     * Send data through the WebSocket connection.
     * Returns false if not connected, true if sent successfully.
     */
    function send(data: string | ArrayBuffer | Blob): boolean {
      if (status.value !== 'OPEN') {
        return false
      }
      return wsSend(data)
    }

    // =========================================================================
    // Return
    // =========================================================================

    return {
      status: readonly(status),
      send,
      syncError: readonly(syncError),
      retryCount: readonly(retryCount),
      retry,
    }
  },
  { injectionKey: IDB_SYNC_RECONNECTION_INJECTION_KEY },
)

// =============================================================================
// CONSUMER COMPOSABLE (WITH ERROR HANDLING)
// =============================================================================

/**
 * Consumer composable that throws if provider is not found.
 *
 * @throws Error if useIDBSyncReconnectionProvider was not called in a parent component
 *
 * @example
 * ```typescript
 * // In a parent component (e.g., App.vue or layout)
 * const reconnection = useIDBSyncReconnectionProvider({
 *   peer: 'wss://example.com/_ws'
 * })
 *
 * // In a child component
 * const { status, send, syncError, retryCount, retry } = useIDBSyncReconnection()
 *
 * // Check connection status
 * if (status.value === 'OPEN') {
 *   send(JSON.stringify({ type: 'sync', data: [...] }))
 * }
 *
 * // Handle errors
 * if (syncError.value) {
 *   console.error('Sync failed:', syncError.value.message)
 *   // User can click retry
 *   retry()
 * }
 * ```
 */
export function useIDBSyncReconnection(): UseIDBSyncReconnectionReturn {
  const state = useIDBSyncReconnectionInjected()

  if (state === undefined) {
    throw new Error(
      '[idb-sync-reconnection] useIDBSyncReconnection() was called without a provider. '
      + 'Make sure to call useIDBSyncReconnectionProvider() in a parent component.',
    )
  }

  return state
}

// =============================================================================
// EXPORTS
// =============================================================================

export { useIDBSyncReconnectionProvider }
