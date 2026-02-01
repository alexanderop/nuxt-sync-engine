/**
 * IndexedDB Sync Engine Provider Composable
 * ==========================================
 *
 * Provides a unified sync engine context for IndexedDB-based local-first data.
 * Uses VueUse's createInjectionState for the provider/consumer pattern.
 *
 * > **Migration Note**
 * >
 * > This composable is named useIDBSyncEngine (not useSyncEngine) to avoid
 * > conflicts with the existing SQLite-based sync engine during migration.
 *
 * > **VueUse Integration**
 * >
 * > - createInjectionState for provider pattern
 * > - useOnline for network status
 * > - useWebSocket for WebSocket with auto-reconnect
 */

import type { Ref, ShallowRef } from 'vue'
import type { UseSessionTrackingReturn } from './useSessionTracking'
import type { UseUnsyncedTrackerReturn } from './useUnsyncedTracker'
import { createInjectionState, useOnline, useWebSocket } from '@vueuse/core'
import { useIndexedDB } from './useIndexedDB'
import { useSessionTracking } from './useSessionTracking'
import { useUnsyncedTracker } from './useUnsyncedTracker'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Options for the IDB Sync Engine provider.
 */
export interface IDBSyncEngineOptions {
  /** WebSocket URL for sync server */
  peer?: string
}

/**
 * WebSocket status type from VueUse.
 */
export type WebSocketStatus = 'OPEN' | 'CLOSED' | 'CONNECTING'

/**
 * Return type for the useIDBSyncEngine composable.
 */
export interface UseIDBSyncEngineReturn {
  /** The IndexedDB database instance (shallowRef to prevent deep reactivity) */
  db: ShallowRef<IDBDatabase | null>
  /** Whether the database is ready for use */
  isReady: Ref<boolean>
  /** Whether the device is online */
  isOnline: Ref<boolean>
  /** Unique device identifier */
  deviceId: Ref<string>
  /** WebSocket connection status */
  wsStatus: Ref<WebSocketStatus>
  /** Send data through WebSocket */
  send: (data: string | ArrayBuffer | Blob) => boolean
  /** Mark an entity as needing sync */
  markUnsynced: UseUnsyncedTrackerReturn['markUnsynced']
  /** Mark an entity as synced */
  markSynced: UseUnsyncedTrackerReturn['markSynced']
  /** Get all entity IDs that need syncing */
  getUnsyncedIds: UseUnsyncedTrackerReturn['getUnsyncedIds']
  /** Record an operation on an entity */
  recordOperation: UseSessionTrackingReturn['recordOperation']
  /** Get known state for an entity */
  getKnownState: UseSessionTrackingReturn['getKnownState']
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEVICE_ID_STORAGE_KEY = 'idb-sync-engine-device-id'
const IDB_SYNC_ENGINE_INJECTION_KEY = Symbol('idb-sync-engine')

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get or create a device ID from localStorage.
 * Returns a stable identifier for this device/browser.
 */
function getOrCreateDeviceId(): string {
  // Server-side: return placeholder (will be replaced on client)
  if (typeof window === 'undefined') {
    return ''
  }

  let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY)

  if (!deviceId) {
    deviceId = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId)
    console.info('[idb-sync-engine] Generated new device ID:', `${deviceId.slice(0, 8)}...`)
  }

  return deviceId
}

// =============================================================================
// PROVIDER COMPOSABLE
// =============================================================================

/**
 * Create the IDB Sync Engine provider and consumer using VueUse's createInjectionState.
 *
 * The provider initializes:
 * - IndexedDB database connection
 * - Device ID (from localStorage)
 * - Network status (via useOnline)
 * - WebSocket connection (via useWebSocket) if peer URL provided
 * - Unsynced tracker for sync state
 * - Session tracking for causal ordering
 */
const [useIDBSyncEngineProvider, useIDBSyncEngineInjected] = createInjectionState(
  (options: IDBSyncEngineOptions = {}): UseIDBSyncEngineReturn => {
    // =========================================================================
    // Device ID
    // =========================================================================

    const deviceId = ref(getOrCreateDeviceId())

    // =========================================================================
    // IndexedDB Initialization
    // =========================================================================

    const { db, isReady, init } = useIndexedDB()

    // Initialize database on mount
    onMounted(async () => {
      try {
        await init()
        console.info('[idb-sync-engine] Database initialized')
      }
      catch (error) {
        console.error('[idb-sync-engine] Failed to initialize database:', error)
      }
    })

    // =========================================================================
    // Network Status (VueUse)
    // =========================================================================

    const isOnline = useOnline()

    // =========================================================================
    // WebSocket Connection (VueUse)
    // =========================================================================

    // Default WebSocket status when no peer is configured
    const defaultWsStatus = ref<WebSocketStatus>('CLOSED')
    const noopSend = (_data: string | ArrayBuffer | Blob): boolean => false

    // Configure WebSocket if peer URL is provided
    const wsConfig = options.peer
      ? useWebSocket(options.peer, {
          autoReconnect: {
            // Infinite retries with exponential backoff
            retries: () => true,
            // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
            delay: (retries: number) => Math.min(1000 * 2 ** (retries - 1), 30000),
          },
          immediate: true,
        })
      : null

    // Extract WebSocket status and send function
    const wsStatus = wsConfig ? wsConfig.status : defaultWsStatus
    const wsSend = wsConfig ? wsConfig.send : noopSend

    // =========================================================================
    // Unsynced Tracker
    // =========================================================================

    const unsyncedTracker = useUnsyncedTracker(db)

    // =========================================================================
    // Session Tracking
    // =========================================================================

    // Session tracking needs the deviceId value
    // We create it lazily after deviceId is available
    const sessionTrackingRef = shallowRef<UseSessionTrackingReturn | null>(null)

    // Initialize session tracking when device ID is ready
    watchEffect(() => {
      if (deviceId.value && !sessionTrackingRef.value) {
        sessionTrackingRef.value = useSessionTracking(db, deviceId.value)
      }
    })

    // Wrapper functions for session tracking that handle the lazy initialization
    async function recordOperation(
      entityType: string,
      entityId: string,
      operation: 'create' | 'update' | 'delete',
      changes: Record<string, unknown>,
    ): Promise<void> {
      const tracking = sessionTrackingRef.value
      if (!tracking) {
        throw new Error('[idb-sync-engine] Session tracking not initialized')
      }
      return tracking.recordOperation(entityType, entityId, operation, changes)
    }

    async function getKnownState(
      entityType: string,
      entityId: string,
    ): Promise<Record<string, number>> {
      const tracking = sessionTrackingRef.value
      if (!tracking) {
        throw new Error('[idb-sync-engine] Session tracking not initialized')
      }
      return tracking.getKnownState(entityType, entityId)
    }

    // =========================================================================
    // Return Combined State
    // =========================================================================

    return {
      // Database
      db,
      isReady,

      // Network
      isOnline,
      deviceId,

      // WebSocket
      wsStatus,
      send: wsSend,

      // Unsynced Tracker
      markUnsynced: unsyncedTracker.markUnsynced,
      markSynced: unsyncedTracker.markSynced,
      getUnsyncedIds: unsyncedTracker.getUnsyncedIds,

      // Session Tracking
      recordOperation,
      getKnownState,
    }
  },
  { injectionKey: IDB_SYNC_ENGINE_INJECTION_KEY },
)

// =============================================================================
// CONSUMER COMPOSABLE (WITH ERROR HANDLING)
// =============================================================================

/**
 * Consumer composable that throws if provider is not found.
 *
 * @throws Error if useIDBSyncEngineProvider was not called in a parent component
 *
 * @example
 * ```typescript
 * // In a child component
 * const { db, isReady, send, markUnsynced } = useIDBSyncEngine()
 *
 * // Use the sync engine
 * if (isReady.value) {
 *   markUnsynced('todo-123')
 * }
 * ```
 */
export function useIDBSyncEngine(): UseIDBSyncEngineReturn {
  const state = useIDBSyncEngineInjected()

  if (state === undefined) {
    throw new Error(
      '[idb-sync-engine] useIDBSyncEngine() was called without a provider. '
      + 'Make sure to call useIDBSyncEngineProvider() in a parent component.',
    )
  }

  return state
}

// =============================================================================
// EXPORTS
// =============================================================================

export { useIDBSyncEngineProvider }
