/**
 * Real-Time Sync Composable
 * =========================
 *
 * WebSocket handler for instant synchronization between devices.
 * Broadcasts changes to other connected clients.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's real-time sync provides:
 * > - Efficient binary protocol
 * > - Subscription to specific CoValues
 * > - Automatic reconnection with state recovery
 * > - Presence awareness (who's online)
 * > - Cursor/selection sync for collaboration
 * >
 * > We use a simple broadcast model over WebSocket.
 */

import type { SyncItem, WebSocketMessage, WebSocketSyncMessage } from '../../shared/types'
import { getDeviceId } from './useDeviceId'

// =============================================================================
// TYPES
// =============================================================================

export interface RealtimeSyncOptions {
  /** Callback when changes are received from other devices */
  onChanges: (changes: SyncItem[], schema: string) => void
  /** Callback when connection status changes */
  onConnectionChange?: (connected: boolean) => void
  /** Reconnect delay in ms */
  reconnectDelay?: number
  /** Maximum reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function handleError(event: Event) {
  console.error('[ws] Error:', event)
}

// =============================================================================
// REALTIME SYNC COMPOSABLE
// =============================================================================

/**
 * Create a real-time sync connection.
 *
 * @example
 * ```typescript
 * const { connect, disconnect, broadcast, isConnected } = useRealtimeSync({
 *   onChanges: (changes, schema) => {
 *     console.info(`Received ${changes.length} changes for ${schema}`);
 *     // Apply changes to local database
 *   },
 * });
 *
 * // Connect on mount
 * onMounted(connect);
 *
 * // Broadcast local changes
 * broadcast('todos', [updatedTodo]);
 * ```
 */
export function useRealtimeSync(options: RealtimeSyncOptions) {
  const config = useRuntimeConfig()
  const {
    onChanges,
    onConnectionChange,
    reconnectDelay = config.public.wsReconnectDelay,
    maxReconnectAttempts = 0,
  } = options

  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const reconnectAttempts = ref(0)

  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  let pingIntervalId: ReturnType<typeof setInterval> | null = null

  // ==========================================================================
  // CONNECTION MANAGEMENT
  // ==========================================================================

  /**
   * Connect to the WebSocket server.
   */
  function connect() {
    if (ws.value?.readyState === WebSocket.OPEN) {
      console.info('[ws] Already connected')
      return
    }

    // Clear any pending reconnect
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }

    // Build WebSocket URL
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/_ws`

    console.info('[ws] Connecting to', url)
    ws.value = new WebSocket(url)

    ws.value.addEventListener('open', handleOpen)
    ws.value.addEventListener('close', handleClose)
    ws.value.addEventListener('error', handleError)
    ws.value.addEventListener('message', handleMessage)
  }

  /**
   * Disconnect from the WebSocket server.
   */
  function disconnect() {
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }

    if (pingIntervalId) {
      clearInterval(pingIntervalId)
      pingIntervalId = null
    }

    if (ws.value) {
      ws.value.close()
      ws.value = null
    }

    isConnected.value = false
    reconnectAttempts.value = 0
  }

  /**
   * Schedule a reconnection attempt.
   */
  function scheduleReconnect() {
    if (maxReconnectAttempts > 0 && reconnectAttempts.value >= maxReconnectAttempts) {
      console.info('[ws] Max reconnect attempts reached')
      return
    }

    reconnectAttempts.value++
    const delay = reconnectDelay * Math.min(reconnectAttempts.value, 5) // Exponential backoff, max 5x

    console.info(`[ws] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.value})...`)

    reconnectTimeoutId = setTimeout(() => {
      if (!isConnected.value) {
        connect()
      }
    }, delay)
  }

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  function handleOpen() {
    console.info('[ws] Connected')
    isConnected.value = true
    reconnectAttempts.value = 0
    onConnectionChange?.(true)

    // Send connect message
    const deviceId = getDeviceId()
    send({ type: 'connect', deviceId })

    // Start ping interval
    pingIntervalId = setInterval(() => {
      if (ws.value?.readyState === WebSocket.OPEN) {
        send({ type: 'ping', timestamp: Date.now() })
      }
    }, config.public.wsPingInterval)
  }

  function handleClose(event: CloseEvent) {
    console.info('[ws] Disconnected:', event.code, event.reason)
    isConnected.value = false
    onConnectionChange?.(false)

    if (pingIntervalId) {
      clearInterval(pingIntervalId)
      pingIntervalId = null
    }

    // Only reconnect if not intentionally closed
    if (event.code !== 1000) {
      scheduleReconnect()
    }
  }

  function handleMessage(event: MessageEvent) {
    try {
      const message: WebSocketMessage = JSON.parse(event.data)

      switch (message.type) {
        case 'sync':
          handleSyncMessage(message)
          break

        case 'pong':
          // Ignore pong messages
          break

        case 'error':
          console.error('[ws] Server error:', message.message)
          break

        default:
          console.info('[ws] Unknown message type:', message.type)
      }
    }
    catch (error) {
      console.error('[ws] Failed to parse message:', error)
    }
  }

  function handleSyncMessage(message: WebSocketSyncMessage) {
    const deviceId = getDeviceId()

    // Ignore our own messages
    if (message.deviceId === deviceId) {
      return
    }

    console.info(`[ws] Received ${message.changes.length} changes for ${message.schema} from ${message.deviceId.slice(0, 8)}...`)
    onChanges(message.changes, message.schema)
  }

  // ==========================================================================
  // SEND OPERATIONS
  // ==========================================================================

  /**
   * Send a message to the server.
   */
  function send(message: WebSocketMessage) {
    if (ws.value?.readyState !== WebSocket.OPEN) {
      console.warn('[ws] Cannot send, not connected')
      return
    }

    ws.value.send(JSON.stringify(message))
  }

  /**
   * Broadcast changes to other clients.
   *
   * @example
   * ```typescript
   * broadcast('todos', [{ id: '123', data: { text: 'Updated', completed: true }, ... }]);
   * ```
   */
  function broadcast(schema: string, changes: SyncItem[]) {
    if (changes.length === 0)
      return

    const deviceId = getDeviceId()

    const message: WebSocketSyncMessage = {
      type: 'sync',
      deviceId,
      schema,
      changes,
    }

    send(message)
    console.info(`[ws] Broadcast ${changes.length} changes for ${schema}`)
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  onUnmounted(() => {
    disconnect()
  })

  return {
    // State
    isConnected: readonly(isConnected),

    // Actions
    connect,
    disconnect,
    broadcast,
  }
}

// =============================================================================
// GLOBAL REALTIME SYNC (Singleton)
// =============================================================================

let globalRealtimeSync: ReturnType<typeof useRealtimeSync> | null = null

/**
 * Get or create the global realtime sync instance.
 */
export function useGlobalRealtimeSync(options?: Partial<RealtimeSyncOptions>) {
  if (!globalRealtimeSync) {
    globalRealtimeSync = useRealtimeSync({
      onChanges: options?.onChanges ?? (() => {}),
      onConnectionChange: options?.onConnectionChange,
      ...options,
    })
  }
  return globalRealtimeSync
}
