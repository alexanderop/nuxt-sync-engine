/**
 * Shared Type Definitions
 * =======================
 *
 * Types used by both client and server for the sync protocol.
 * These are the "wire formats" for our simplified Jazz-like sync.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's protocol uses:
 * > - Binary encoding for efficiency
 * > - Cryptographic signatures on every message
 * > - Session-based transaction ordering
 * > - Content-addressed storage
 * >
 * > We use simple JSON with timestamps.
 */

// =============================================================================
// SYNC PROTOCOL MESSAGES
// =============================================================================

/**
 * Jazz-inspired sync message types.
 *
 * Jazz's protocol:
 * - Load: "I want this document"
 * - KnownState: "Here's what I have" (metadata only)
 * - NewContent: "Here are the actual changes"
 * - Done: "Sync complete"
 *
 * Our simplified version:
 * - want: Request data for an entity
 * - have: Advertise what we have (lastSyncAt timestamp)
 * - changes: Send actual data
 * - ack: Confirm receipt
 */
export type SyncMessageType = 'want' | 'have' | 'changes' | 'ack'

/**
 * Base sync message structure.
 */
export interface SyncMessage {
  type: SyncMessageType
  /** Device ID of the sender */
  deviceId: string
  /** Timestamp of this message */
  timestamp: number
}

/**
 * "want" message - Request data.
 * Similar to Jazz's Load message.
 */
export interface WantMessage extends SyncMessage {
  type: 'want'
  /** Schema/table name */
  schema: string
  /** Optional: specific ID to request */
  id?: string
  /** Last sync timestamp (for incremental sync) */
  since?: number
}

/**
 * "have" message - Advertise known state.
 * Similar to Jazz's KnownState message.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's KnownState includes:
 * > - Per-session transaction counts
 * > - Cryptographic signatures
 * > - Efficient bitmap of known transactions
 * >
 * > We just use a single timestamp.
 */
export interface HaveMessage extends SyncMessage {
  type: 'have'
  /** Schema/table name */
  schema: string
  /** Our last sync timestamp */
  lastSyncAt: number
  /** Count of items we have (optional, for debugging) */
  count?: number
}

/**
 * "changes" message - Send actual data.
 * Similar to Jazz's NewContent message.
 */
export interface ChangesMessage extends SyncMessage {
  type: 'changes'
  /** Schema/table name */
  schema: string
  /** The actual changes */
  items: SyncItem[]
  /** Server timestamp when these changes were recorded */
  syncedAt: number
}

/**
 * "ack" message - Confirm receipt.
 * Similar to Jazz's Done message.
 */
export interface AckMessage extends SyncMessage {
  type: 'ack'
  /** Schema/table name */
  schema: string
  /** Timestamp we're acknowledging up to */
  syncedAt: number
  /** Count of items received */
  count: number
}

// =============================================================================
// SYNC ITEMS (The actual data being synced)
// =============================================================================

/**
 * A sync item - any entity with Jazz-like metadata.
 * This is the "wire format" for entities.
 */
export interface SyncItem {
  /** Globally unique ID */
  id: string
  /** The entity data (schema-specific) */
  data: Record<string, unknown>
  /** Creation timestamp */
  createdAt: number
  /** Last modification timestamp */
  updatedAt: number
  /** Device that last modified this */
  deviceId: string
  /** Soft delete flag */
  deleted: boolean
}

/**
 * Todo item in sync format.
 */
export interface TodoSyncItem extends SyncItem {
  data: {
    text: string
    completed: boolean
  }
}

// =============================================================================
// HTTP API TYPES
// =============================================================================

/**
 * Push request - send local changes to server.
 */
export interface SyncPushRequest {
  deviceId: string
  schema: string
  changes: SyncItem[]
  lastSyncAt: number
}

/**
 * Push response - server's reply after receiving changes.
 */
export interface SyncPushResponse {
  /** Server timestamp for this sync */
  syncedAt: number
  /** Items where server had newer version (conflicts) */
  conflicts: SyncItem[]
  /** Count of items successfully stored */
  stored: number
}

/**
 * Pull request parameters.
 */
export interface SyncPullRequest {
  deviceId: string
  schema: string
  since: number
}

/**
 * Pull response - changes from other devices.
 */
export interface SyncPullResponse {
  /** Changes since the requested timestamp */
  changes: SyncItem[]
  /** Server timestamp (use for next pull) */
  syncedAt: number
}

// =============================================================================
// WEBSOCKET MESSAGE TYPES
// =============================================================================

/**
 * WebSocket message types for real-time sync.
 */
export type WebSocketMessageType
  = | 'connect'
    | 'sync'
    | 'ping'
    | 'pong'
    | 'error'

/**
 * Base WebSocket message.
 */
export interface WebSocketMessageBase {
  type: WebSocketMessageType
}

/**
 * Connect message - sent when a client connects.
 */
export interface ConnectMessage extends WebSocketMessageBase {
  type: 'connect'
  deviceId: string
}

/**
 * Sync message - broadcast changes to other clients.
 */
export interface WebSocketSyncMessage extends WebSocketMessageBase {
  type: 'sync'
  deviceId: string
  schema: string
  changes: SyncItem[]
}

/**
 * Ping message - keep-alive.
 */
export interface PingMessage extends WebSocketMessageBase {
  type: 'ping'
  timestamp: number
}

/**
 * Pong message - response to ping.
 */
export interface PongMessage extends WebSocketMessageBase {
  type: 'pong'
  timestamp: number
}

/**
 * Error message - report an error.
 */
export interface ErrorMessage extends WebSocketMessageBase {
  type: 'error'
  message: string
  code?: string
}

/**
 * Union of all WebSocket message types.
 */
export type WebSocketMessage
  = | ConnectMessage
    | WebSocketSyncMessage
    | PingMessage
    | PongMessage
    | ErrorMessage

// =============================================================================
// CONFLICT RESOLUTION
// =============================================================================

/**
 * Conflict resolution strategy.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz supports:
 * > - CRDT-based automatic merging
 * > - Branching and explicit merging (like Git)
 * > - Custom resolution functions per field
 * >
 * > We only support Last-Write-Wins.
 */
export type ConflictStrategy = 'last-write-wins' | 'first-write-wins' | 'manual'

/**
 * A conflict that needs resolution.
 */
export interface SyncConflict {
  /** The item ID */
  id: string
  /** Our local version */
  local: SyncItem
  /** The remote version */
  remote: SyncItem
  /** Which version won (if auto-resolved) */
  winner?: 'local' | 'remote'
}

// =============================================================================
// SYNC STATE
// =============================================================================

/**
 * Current sync state for the UI.
 */
export interface SyncState {
  /** Is a sync operation in progress? */
  isSyncing: boolean
  /** Are we connected to the network? */
  isOnline: boolean
  /** Is the WebSocket connected? */
  isConnected: boolean
  /** Last successful sync timestamp */
  lastSyncAt: number
  /** Any sync error */
  error: string | null
  /** Number of pending changes to sync */
  pendingChanges: number
}
