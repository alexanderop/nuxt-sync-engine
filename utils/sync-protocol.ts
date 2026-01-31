/**
 * Sync Protocol Types & Helpers
 * =============================
 *
 * This file defines the sync protocol inspired by Jazz's sophisticated
 * sync mechanism. We simplify Jazz's 4-message protocol for teaching:
 *
 * | Jazz         | Our Version | Purpose                    |
 * |--------------|-------------|----------------------------|
 * | Load         | `want`      | Request data               |
 * | KnownState   | `have`      | Advertise what we have     |
 * | NewContent   | `changes`   | Send actual data           |
 * | Done         | `ack`       | Confirm sync complete      |
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
// CORE DATA TYPES
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
// JAZZ-INSPIRED SYNC PROTOCOL
// =============================================================================

/**
 * Sync message types inspired by Jazz's protocol.
 *
 * Jazz uses: Load, KnownState, NewContent, Done
 * We simplify to: want, have, changes, ack
 */
export type SyncMessageType = 'want' | 'have' | 'changes' | 'ack'

/**
 * Base message structure for sync protocol.
 */
export interface SyncMessageBase {
  /** Message type */
  type: SyncMessageType
  /** Device ID of sender */
  deviceId: string
  /** Message timestamp */
  timestamp: number
  /** Schema/table being synced */
  schema: string
}

/**
 * "want" message - Request data (like Jazz's Load).
 *
 * Sent by a client to request data for a schema.
 * Server responds with "have" message showing its state.
 */
export interface WantMessage extends SyncMessageBase {
  type: 'want'
  /** Optional: specific ID to request */
  id?: string
  /** Request changes since this timestamp */
  since?: number
}

/**
 * "have" message - Advertise known state (like Jazz's KnownState).
 *
 * Sent in response to "want" or proactively to show current state.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's KnownState message contains:
 * > ```typescript
 * > {
 * >   id: CoValueID,
 * >   header: boolean,
 * >   sessions: {
 * >     [sessionId: SessionID]: number // transaction count
 * >   }
 * > }
 * > ```
 * > This allows syncing only the exact missing transactions.
 * > We just use a single timestamp, which is less efficient.
 */
export interface HaveMessage extends SyncMessageBase {
  type: 'have'
  /** Our last sync timestamp */
  lastSyncAt: number
  /** Number of items we have (for debugging) */
  count?: number
}

/**
 * "changes" message - Send actual data (like Jazz's NewContent).
 *
 * Contains the actual changes being synced.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's NewContent is a transaction with:
 * > - Session ID + transaction index
 * > - Cryptographic signature
 * > - Encrypted payload (optional)
 * > - Causal dependencies
 * >
 * > We just send raw JSON data.
 */
export interface ChangesMessage extends SyncMessageBase {
  type: 'changes'
  /** The actual data */
  items: Todo[]
  /** Server timestamp for these changes */
  syncedAt: number
}

/**
 * "ack" message - Confirm receipt (like Jazz's Done).
 *
 * Sent to confirm successful receipt of changes.
 */
export interface AckMessage extends SyncMessageBase {
  type: 'ack'
  /** Timestamp we're acknowledging up to */
  syncedAt: number
  /** Number of items received */
  count: number
}

/**
 * Union of all sync message types.
 */
export type SyncMessage = WantMessage | HaveMessage | ChangesMessage | AckMessage

// =============================================================================
// HTTP API TYPES (Simplified REST interface)
// =============================================================================

/**
 * Payload sent from client to server when pushing changes.
 */
export interface SyncPushPayload {
  device_id: string
  changes: Todo[]
  last_sync_at: number
}

/**
 * Response from server after a push.
 */
export interface SyncPushResponse {
  synced_at: number
  conflicts: Todo[]
}

/**
 * Response from server when pulling changes.
 */
export interface SyncPullResponse {
  changes: Todo[]
  synced_at: number
}

// =============================================================================
// WEBSOCKET MESSAGE TYPES
// =============================================================================

/**
 * WebSocket message types for real-time sync.
 */
export type WebSocketMessageType = 'sync' | 'ping' | 'pong' | 'connected' | 'error'

/**
 * WebSocket sync message - broadcasts changes to other clients.
 */
export interface WebSocketSyncMessage {
  type: 'sync'
  device_id: string
  changes: Todo[]
}

/**
 * WebSocket message union type.
 */
export interface WebSocketMessage {
  type: WebSocketMessageType
  payload?: {
    device_id?: string
    changes?: Todo[]
    message?: string
  }
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
