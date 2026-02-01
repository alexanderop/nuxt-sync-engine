/**
 * Session Tracking Composable
 * ===========================
 *
 * Implements session-based causal ordering (Jazz pattern) for tracking
 * operations on entities. Each browser session gets a unique session ID
 * and operations are tracked with incrementing indices per session.
 *
 * > **Jazz Pattern Adoption**
 * >
 * > This implementation adopts Jazz's session-based causal ordering:
 * > - Each session gets a unique ID combining deviceId, timestamp, and random
 * > - Operations are indexed per session for causal ordering
 * > - Known state is a map of sessionId -> lastIdx for vector clock comparison
 */

import type { Ref } from 'vue'
import type { OperationRecord, SessionRecord } from './useIndexedDB'
import { addRecord, getAllFromIndex, getFromIndex, promisify } from '~/utils/idb-helpers'
import { txQueue } from '~/utils/idb-transaction-queue'

export interface UseSessionTrackingReturn {
  /** Unique session ID for this browser session */
  sessionId: string
  /** Record an operation on an entity */
  recordOperation: (
    entityType: string,
    entityId: string,
    operation: 'create' | 'update' | 'delete',
    changes: Record<string, unknown>,
  ) => Promise<void>
  /** Get known state (sessionId -> lastIdx map) for an entity */
  getKnownState: (
    entityType: string,
    entityId: string,
  ) => Promise<Record<string, number>>
}

/**
 * Generate a short random ID (nanoid-like).
 * Uses crypto.getRandomValues for better randomness.
 */
function generateId(length = 8): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}

/**
 * Create a unique session ID.
 * Format: deviceId_timestamp_randomId
 */
function createSessionId(deviceId: string): string {
  return `${deviceId}_${Date.now()}_${generateId()}`
}

/**
 * Session tracking composable for recording and querying operations.
 *
 * @param db - Reactive reference to the IndexedDB database
 * @param deviceId - The device identifier for this client
 *
 * @example
 * ```typescript
 * const { db, init } = useIndexedDB()
 * const deviceId = useDeviceId()
 *
 * await init()
 *
 * const { sessionId, recordOperation, getKnownState } = useSessionTracking(db, deviceId.value)
 *
 * // Record an operation
 * await recordOperation('todos', 'todo-123', 'update', { completed: true })
 *
 * // Get known state for sync
 * const state = await getKnownState('todos', 'todo-123')
 * // Returns: { "device1_1234567890_abc": 3, "device2_1234567891_xyz": 5 }
 * ```
 */
export function useSessionTracking(
  db: Ref<IDBDatabase | null>,
  deviceId: string,
): UseSessionTrackingReturn {
  // Generate session ID once when composable is created (stable per session)
  const sessionId = createSessionId(deviceId)

  /**
   * Record an operation on an entity.
   * Creates or updates the session and adds the operation to the operations store.
   */
  async function recordOperation(
    entityType: string,
    entityId: string,
    operation: 'create' | 'update' | 'delete',
    changes: Record<string, unknown>,
  ): Promise<void> {
    const database = toValue(db)
    if (!database) {
      throw new Error('[session-tracking] Database not initialized')
    }

    await txQueue.enqueue(
      database,
      ['sessions', 'operations'],
      'readwrite',
      async (tx) => {
        const sessionsStore = tx.objectStore('sessions')
        const operationsStore = tx.objectStore('operations')

        // Try to find existing session using unique index
        const uniqueIndex = sessionsStore.index('unique')
        const existingSession = await getFromIndex<SessionRecord>(
          uniqueIndex,
          [entityType, entityId, sessionId],
        )

        let sessionRowId: number
        let nextIdx: number

        if (existingSession && existingSession.rowID !== undefined) {
          // Session exists - use it and increment idx
          sessionRowId = existingSession.rowID
          nextIdx = existingSession.lastIdx + 1

          // Update session's lastIdx
          await promisify(
            sessionsStore.put({
              ...existingSession,
              lastIdx: nextIdx,
            }),
          )
        }
        else {
          // Create new session
          nextIdx = 1
          const newSession: Omit<SessionRecord, 'rowID'> = {
            entityType,
            entityId,
            sessionId,
            lastIdx: nextIdx,
          }

          // Add session and get the auto-generated rowID
          sessionRowId = await addRecord(sessionsStore, newSession)
        }

        // Add operation to operations store
        const operationRecord: OperationRecord = {
          sessionRowId,
          idx: nextIdx,
          operation,
          changes,
          madeAt: Date.now(),
        }

        await promisify(operationsStore.add(operationRecord))
      },
    )
  }

  /**
   * Get the known state for an entity.
   * Returns a map of sessionId -> lastIdx for all sessions that have operations on this entity.
   */
  async function getKnownState(
    entityType: string,
    entityId: string,
  ): Promise<Record<string, number>> {
    const database = toValue(db)
    if (!database) {
      throw new Error('[session-tracking] Database not initialized')
    }

    const tx = database.transaction('sessions', 'readonly')
    const sessionsStore = tx.objectStore('sessions')
    const entityIndex = sessionsStore.index('by_entity')

    // Get all sessions for this entity
    const sessions = await getAllFromIndex<SessionRecord>(
      entityIndex,
      [entityType, entityId],
    )

    // Build the known state map
    const knownState: Record<string, number> = {}
    for (const session of sessions) {
      knownState[session.sessionId] = session.lastIdx
    }

    return knownState
  }

  return {
    sessionId,
    recordOperation,
    getKnownState,
  }
}
