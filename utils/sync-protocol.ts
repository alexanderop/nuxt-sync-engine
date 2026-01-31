/**
 * Sync Protocol Helpers
 * =====================
 *
 * Domain types and helper functions for the sync protocol.
 * Wire format types are in shared/types/index.ts.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's sync protocol includes:
 * > - **Session-based transactions**: Each session has its own counter
 * > - **Cryptographic signatures**: Every change is verifiable
 * > - **Causal ordering**: Changes ordered by causality, not time
 * > - **Efficient diffing**: KnownState exchange minimizes data transfer
 * > - **Binary encoding**: Compact wire format
 * >
 * > We use simple JSON with timestamps.
 */

// =============================================================================
// DOMAIN TYPES
// =============================================================================

/**
 * A Todo item - the main entity we're syncing.
 *
 * Key fields for sync:
 * - `id`: UUID, globally unique across all devices
 * - `updated_at`: Unix timestamp (ms), used for conflict resolution
 * - `deleted`: Soft delete flag - we never hard delete during sync
 * - `device_id`: Which device created/modified this todo
 *
 * > **What Jazz Does Better**
 * >
 * > In Jazz, a Todo would be a CoMap with:
 * > - Automatic ID generation (content-addressed)
 * > - Per-field edit tracking
 * > - Cryptographic ownership proof
 * > - Permission inheritance from parent
 */
export interface Todo {
  id: string
  text: string
  completed: boolean
  updated_at: number
  deleted: boolean
  device_id: string
}

/**
 * Database row format (SQLite stores booleans as integers)
 */
export interface TodoRow {
  id: string
  text: string
  completed: number // 0 or 1
  updated_at: number
  deleted: number // 0 or 1
  device_id: string
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert a database row to a Todo object.
 * SQLite stores booleans as 0/1, so we convert them.
 */
export function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed === 1,
    updated_at: row.updated_at,
    deleted: row.deleted === 1,
    device_id: row.device_id,
  }
}

/**
 * Convert a Todo to database row format.
 */
export function todoToRow(todo: Todo): TodoRow {
  return {
    id: todo.id,
    text: todo.text,
    completed: todo.completed ? 1 : 0,
    updated_at: todo.updated_at,
    deleted: todo.deleted ? 1 : 0,
    device_id: todo.device_id,
  }
}

/**
 * Generate a timestamp for "now" in milliseconds.
 */
export function now(): number {
  return Date.now()
}

/**
 * Compare two todos for conflict resolution.
 * Returns true if `incoming` should win over `existing`.
 *
 * Our strategy: Last-Write-Wins (LWW)
 * - The todo with the higher updated_at wins
 * - If equal, the one with the "higher" device_id wins (deterministic tiebreaker)
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz uses session-based ordering with causal dependencies:
 * > ```
 * > Session A: tx1 -> tx2 -> tx3
 * > Session B: tx1 -> tx2
 * >
 * > Even if B.tx2 has a later timestamp than A.tx3,
 * > Jazz can correctly merge based on causality.
 * > ```
 * >
 * > For concurrent edits to the same field, Jazz supports:
 * > - CRDT-based automatic merging
 * > - Explicit branching (like Git)
 * > - Custom merge functions
 * >
 * > We just pick the latest timestamp.
 */
export function shouldIncomingWin(incoming: Todo, existing: Todo): boolean {
  if (incoming.updated_at > existing.updated_at) {
    return true
  }
  if (incoming.updated_at === existing.updated_at) {
    // Deterministic tiebreaker: compare device IDs lexicographically
    return incoming.device_id > existing.device_id
  }
  return false
}

// =============================================================================
// SYNC PROTOCOL CONSTANTS
// =============================================================================

/**
 * Protocol version for compatibility checking.
 */
export const PROTOCOL_VERSION = '1.0.0'

/**
 * Default sync interval in milliseconds.
 */
export const DEFAULT_SYNC_INTERVAL = 30000

/**
 * Maximum items per sync batch.
 */
export const MAX_BATCH_SIZE = 100

/**
 * WebSocket ping interval in milliseconds.
 */
export const WS_PING_INTERVAL = 30000

/**
 * WebSocket reconnect delay in milliseconds.
 */
export const WS_RECONNECT_DELAY = 3000
