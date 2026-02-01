/**
 * IDB Sync Status Composable
 * ==========================
 *
 * User feedback patterns for sync status. Provides computed status messages
 * based on connection state, sync progress, and storage health.
 *
 * > **Status Priority**
 * >
 * > Status messages are computed with the following priority:
 * > 1. Error (sync failed)
 * > 2. Offline (no network)
 * > 3. Connecting (WebSocket connecting)
 * > 4. Syncing (changes pending)
 * > 5. Warning (low storage)
 * > 6. Synced (all good)
 */

import type { ComputedRef, Ref } from 'vue'
import { useIntervalFn, useOnline } from '@vueuse/core'
import { useIDBSyncEngine } from './useIDBSyncEngine'
import { useStorageQuota } from './useStorageQuota'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Status types for sync feedback.
 */
export type StatusType = 'error' | 'offline' | 'connecting' | 'syncing' | 'warning' | 'synced'

/**
 * Status message for user feedback.
 */
export interface StatusMessage {
  /** Type of status for styling/icons */
  type: StatusType
  /** Human-readable message */
  message: string
}

/**
 * Return type for the useIDBSyncStatus composable.
 */
export interface UseIDBSyncStatusReturn {
  /** Computed status message based on current state */
  statusMessage: ComputedRef<StatusMessage>
  /** Number of unsynced changes */
  unsyncedCount: Readonly<Ref<number>>
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Interval for polling unsynced count (5 seconds) */
const POLL_INTERVAL_MS = 5000

// =============================================================================
// COMPOSABLE
// =============================================================================

/**
 * Sync status composable for user feedback.
 *
 * Provides a computed status message and unsynced count that updates
 * based on connection state, sync progress, and storage health.
 *
 * @example
 * ```typescript
 * const { statusMessage, unsyncedCount } = useIDBSyncStatus()
 *
 * // In template
 * <div :class="statusMessage.type">
 *   {{ statusMessage.message }}
 * </div>
 *
 * // Status types: 'error' | 'offline' | 'connecting' | 'syncing' | 'warning' | 'synced'
 * ```
 */
export function useIDBSyncStatus(): UseIDBSyncStatusReturn {
  // =========================================================================
  // Dependencies
  // =========================================================================

  // Get WebSocket status and sync error from sync engine
  const { wsStatus, syncError, getUnsyncedIds } = useIDBSyncEngine()

  // Network status
  const isOnline = useOnline()

  // Storage quota
  const { isLowStorage, checkQuota } = useStorageQuota()

  // =========================================================================
  // Unsynced Count Tracking
  // =========================================================================

  /** Current count of unsynced changes */
  const unsyncedCount = ref(0)

  /**
   * Update the unsynced count from the database.
   */
  async function updateUnsyncedCount(): Promise<void> {
    try {
      const ids = await getUnsyncedIds()
      unsyncedCount.value = ids.length
    }
    catch (error) {
      console.error('[idb-sync-status] Failed to get unsynced count:', error)
    }
  }

  // Poll unsynced count every 5 seconds
  useIntervalFn(updateUnsyncedCount, POLL_INTERVAL_MS, {
    immediate: true,
    immediateCallback: true,
  })

  // Also check storage quota periodically
  useIntervalFn(checkQuota, POLL_INTERVAL_MS, {
    immediate: true,
    immediateCallback: true,
  })

  // =========================================================================
  // Computed Status Message
  // =========================================================================

  /**
   * Compute the status message based on priority:
   * 1. Error (sync failed)
   * 2. Offline (no network)
   * 3. Connecting (WebSocket connecting)
   * 4. Syncing (changes pending)
   * 5. Warning (low storage)
   * 6. Synced (all good)
   */
  const statusMessage = computed<StatusMessage>(() => {
    // Priority 1: Sync error
    if (syncError.value) {
      return {
        type: 'error',
        message: 'Sync failed. Click to retry.',
      }
    }

    // Priority 2: Offline
    if (!isOnline.value) {
      return {
        type: 'offline',
        message: 'Offline - changes saved locally',
      }
    }

    // Priority 3: Connecting
    if (wsStatus.value === 'CONNECTING') {
      return {
        type: 'connecting',
        message: 'Connecting...',
      }
    }

    // Priority 4: Syncing (has unsynced changes)
    if (unsyncedCount.value > 0) {
      const count = unsyncedCount.value
      const plural = count === 1 ? 'change' : 'changes'
      return {
        type: 'syncing',
        message: `Syncing ${count} ${plural}...`,
      }
    }

    // Priority 5: Low storage warning
    if (isLowStorage.value) {
      return {
        type: 'warning',
        message: 'Storage almost full',
      }
    }

    // Priority 6: All synced
    return {
      type: 'synced',
      message: 'All changes saved',
    }
  })

  // =========================================================================
  // Return
  // =========================================================================

  return {
    statusMessage,
    unsyncedCount: readonly(unsyncedCount),
  }
}
