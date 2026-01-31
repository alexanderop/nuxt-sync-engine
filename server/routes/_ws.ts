/**
 * WebSocket Handler
 * =================
 *
 * Real-time sync via WebSocket using Nitro's built-in support.
 * Broadcasts changes to all connected clients.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's WebSocket protocol:
 * > - Efficient binary encoding
 * > - Per-CoValue subscriptions
 * > - Presence and cursor sync
 * > - Automatic reconnection with state recovery
 * >
 * > We use simple JSON broadcast to all clients.
 */

import type { WebSocketMessage, WebSocketSyncMessage } from '../../shared/types'

/**
 * WebSocket route handler.
 *
 * This uses Nitro's experimental WebSocket support via CrossWS.
 * The route is at `/_ws` based on the filename.
 */
export default defineWebSocketHandler({
  /**
   * Called when a client connects.
   */
  open(peer) {
    // Subscribe to the sync channel
    peer.subscribe('sync-channel')
    console.info(`[ws] Client connected: ${peer.id}`)

    // Send welcome message
    peer.send(
      JSON.stringify({
        type: 'connected',
        peerId: peer.id,
        timestamp: Date.now(),
      }),
    )
  },

  /**
   * Called when a message is received from a client.
   */
  message(peer, message) {
    try {
      const data: WebSocketMessage = JSON.parse(message.text())

      switch (data.type) {
        case 'connect':
          // Client is identifying itself
          console.info(`[ws] Client identified: ${data.deviceId}`)
          break

        case 'sync':
          handleSyncMessage(peer, data)
          break

        case 'ping':
          // Respond with pong
          peer.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
          break

        default:
          console.info(`[ws] Unknown message type: ${data.type}`)
      }
    }
    catch (error) {
      console.error('[ws] Invalid message:', error)
      peer.send(
        JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
        }),
      )
    }
  },

  /**
   * Called when a client disconnects.
   */
  close(peer) {
    console.info(`[ws] Client disconnected: ${peer.id}`)
  },

  /**
   * Called when an error occurs.
   */
  error(peer, error) {
    console.error(`[ws] Error for ${peer.id}:`, error)
  },
})

/**
 * Handle sync message - broadcast to all other clients.
 */
function handleSyncMessage(peer: { id: string, publish: (channel: string, message: string) => void }, message: WebSocketSyncMessage) {
  console.info(
    `[ws] Broadcasting ${message.changes.length} changes for ${message.schema} from ${message.deviceId.slice(0, 8)}...`,
  )

  // Broadcast to all peers on the sync channel
  // Note: The sender will also receive this, but we filter by deviceId on the client
  peer.publish('sync-channel', JSON.stringify(message))
}
