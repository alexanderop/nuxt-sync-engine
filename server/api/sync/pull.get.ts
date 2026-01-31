/**
 * Pull Endpoint
 * =============
 *
 * Returns changes made by other devices since a given timestamp.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's sync protocol:
 * > - Uses KnownState to exchange metadata first
 * > - Only sends the actual diff
 * > - Streams large datasets efficiently
 * > - Supports partial/filtered sync
 * >
 * > We just query by timestamp and device.
 */

import type { SyncPullResponse } from '../../../shared/types'
import { getChangesSince, getDatabase } from '../../database'

export default defineEventHandler(async (event): Promise<SyncPullResponse> => {
  const query = getQuery(event)

  const schema = String(query.schema || '')
  const since = Number(query.since) || 0
  const deviceId = String(query.deviceId || '')

  // Validate table name
  const allowedTables = ['todos', 'projects']
  if (!allowedTables.includes(schema)) {
    throw createError({
      statusCode: 400,
      message: `Invalid schema: ${schema}`,
    })
  }

  // Initialize database
  await getDatabase()

  // Get changes, excluding the requesting device's own changes
  const changes = getChangesSince(schema, since, deviceId)

  console.log(
    `[pull] Returning ${changes.length} changes for ${schema} since ${since} (excluding ${deviceId.slice(0, 8)}...)`,
  )

  return {
    changes,
    syncedAt: Date.now(),
  }
})
