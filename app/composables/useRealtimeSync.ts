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
import { useWebSocket } from '@vueuse/core'
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

  // Build WebSocket URL
  const wsUrl = computed(() => {
    if (import.meta.server)
      return ''
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${location.host}/_ws`
  })

  const { status, send: wsSend, open, close } = useWebSocket(wsUrl, {
    immediate: false,
    autoReconnect: {
      retries: maxReconnectAttempts === 0 ? -1 : maxReconnectAttempts,
      delay: reconnectDelay,
      onFailed() {
        console.info('[ws] Max reconnect attempts reached')
      },
    },
    heartbeat: {
      message: () => JSON.stringify({ type: 'ping', timestamp: Date.now() }),
      interval: config.public.wsPingInterval,
      pongTimeout: config.public.wsPingInterval * 2,
    },
    onConnected() {
      console.info('[ws] Connected')
      onConnectionChange?.(true)

      // Send connect message
      const deviceId = getDeviceId()
      sendMessage({ type: 'connect', deviceId })
    },
    onDisconnected(_ws, event) {
      console.info('[ws] Disconnected:', event.code, event.reason)
      onConnectionChange?.(false)
    },
    onError(_ws, event) {
      console.error('[ws] Error:', event)
    },
    onMessage(_ws, event) {
      handleMessage(event)
    },
  })

  const isConnected = computed(() => status.value === 'OPEN')

  // ==========================================================================
  // MESSAGE HANDLING
  // ==========================================================================

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

  function sendMessage(message: WebSocketMessage) {
    if (status.value !== 'OPEN') {
      console.warn('[ws] Cannot send, not connected')
      return
    }

    wsSend(JSON.stringify(message))
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

    sendMessage(message)
    console.info(`[ws] Broadcast ${changes.length} changes for ${schema}`)
  }

  // ==========================================================================
  // CONNECTION CONTROL
  // ==========================================================================

  function connect() {
    if (status.value === 'OPEN') {
      console.info('[ws] Already connected')
      return
    }
    console.info('[ws] Connecting to', wsUrl.value)
    open()
  }

  function disconnect() {
    close()
  }

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
