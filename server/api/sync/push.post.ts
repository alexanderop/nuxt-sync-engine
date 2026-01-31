/**
 * Push Endpoint
 * =============
 *
 * Receives changes from a client and stores them.
 * Returns conflicts where the server has newer versions.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's server:
 * > - Validates cryptographic signatures
 * > - Checks permissions before accepting
 * > - Stores changes in append-only log
 * > - Broadcasts to subscribed peers
 * >
 * > We just do simple timestamp-based conflict detection.
 */

import type { SyncPushRequest, SyncPushResponse } from '../../../shared/types'
import { batchUpsert, getDatabase } from '../../database'

export default defineEventHandler(async (event): Promise<SyncPushResponse> => {
  const body = await readBody<SyncPushRequest>(event)
  const { schema, changes } = body

  // Validate request
  if (!schema || !Array.isArray(changes)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request: schema and changes are required',
    })
  }

  // Validate table name (prevent SQL injection)
  const allowedTables = ['todos', 'projects']
  if (!allowedTables.includes(schema)) {
    throw createError({
      statusCode: 400,
      message: `Invalid schema: ${schema}`,
    })
  }

  // Initialize database
  await getDatabase()

  // Process changes
  const { stored, conflicts } = batchUpsert(schema, changes)

  console.log(
    `[push] Received ${changes.length} changes for ${schema}: ${stored} stored, ${conflicts.length} conflicts`,
  )

  return {
    syncedAt: Date.now(),
    conflicts,
    stored,
  }
})
