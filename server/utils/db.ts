/**
 * Server Database Module
 * ======================
 *
 * SQLite database for the sync server using better-sqlite3.
 * Auto-imported by Nitro in all server routes.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's server storage provides:
 * > - Content-addressed storage (immutable, verifiable)
 * > - Efficient session-based indexing
 * > - Automatic garbage collection
 * > - Distributed storage options
 * >
 * > We use a simple SQLite database with timestamp-based queries.
 */

import type { SyncItem } from '../../shared/types'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { tryCatchSync } from '../../utils/tryCatch'

// =============================================================================
// DATABASE INSTANCE
// =============================================================================

let db: Database.Database | null = null

// Type guards for better-sqlite3 return values
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toRecordArray(rows: unknown[]): Record<string, unknown>[] {
  return rows.filter(isRecord)
}

function toRecordOrUndefined(row: unknown): Record<string, unknown> | undefined {
  return isRecord(row) ? row : undefined
}

/**
 * Get the database instance, initializing if needed.
 */
function getDbPath(config: ReturnType<typeof useRuntimeConfig>): string {
  if (typeof config.databasePath === 'string')
    return config.databasePath
  return 'data/sync.db'
}

export async function getDatabase(): Promise<Database.Database> {
  if (db)
    return db

  const config = useRuntimeConfig()
  const dbPath = getDbPath(config)

  // Create data directory
  await mkdir(dirname(dbPath), { recursive: true })

  // Initialize database with WAL mode for performance
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  // Create tables
  const [execError] = tryCatchSync(() =>
    db!.exec(`
    -- Todos table (matches client schema)
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      deleted INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos(updated_at);
    CREATE INDEX IF NOT EXISTS idx_todos_device_id ON todos(device_id);
    CREATE INDEX IF NOT EXISTS idx_todos_deleted ON todos(deleted);

    -- Projects table
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      deleted INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);

    -- Sync metadata
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `),
  )

  if (execError) {
    throw new Error(`Failed to initialize database schema: ${execError.message}`)
  }

  console.info('[db] Server database initialized')
  return db
}

// =============================================================================
// SYNC OPERATIONS
// =============================================================================

/**
 * Get changes since a timestamp, excluding a specific device.
 * Named differently from client-side getChangesSince to avoid auto-import collision.
 */
export function getServerChangesSince(
  tableName: string,
  since: number,
  excludeDeviceId?: string,
): SyncItem[] {
  if (!db)
    throw new Error('Database not initialized')

  let query = `
    SELECT * FROM ${tableName}
    WHERE updated_at > ?
  `
  const params: unknown[] = [since]

  if (excludeDeviceId) {
    query += ' AND device_id != ?'
    params.push(excludeDeviceId)
  }

  query += ' ORDER BY updated_at ASC'

  const [queryError, rawRows] = tryCatchSync(() => db!.prepare(query).all(...params))
  if (queryError) {
    throw new Error(`Failed to query changes: ${queryError.message}`)
  }

  const rows = toRecordArray(rawRows)
  return rows.map(rowToSyncItem)
}

/**
 * Get a single item by ID.
 */
export function getItemById(tableName: string, id: string): SyncItem | null {
  if (!db)
    throw new Error('Database not initialized')

  const [queryError, rawRow] = tryCatchSync(() =>
    db!.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id),
  )
  if (queryError) {
    throw new Error(`Failed to get item by id: ${queryError.message}`)
  }

  const row = toRecordOrUndefined(rawRow)
  return row ? rowToSyncItem(row) : null
}

/**
 * Upsert an item (insert or update).
 * Returns true if the item was inserted/updated, false if a newer version exists.
 */
export function upsertItem(tableName: string, item: SyncItem): boolean {
  if (!db)
    throw new Error('Database not initialized')

  // Check for existing item
  const existing = getItemById(tableName, item.id)

  // If existing item is newer, don't update
  if (existing && existing.updatedAt >= item.updatedAt) {
    return false
  }

  // Build upsert query based on table
  const columns = getTableColumns(tableName)
  const values = buildRowValues(item, columns)
  const placeholders = columns.map(() => '?').join(', ')

  const [upsertError] = tryCatchSync(() =>
    db!.prepare(
      `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
    ).run(...values),
  )
  if (upsertError) {
    throw new Error(`Failed to upsert item: ${upsertError.message}`)
  }

  return true
}

/**
 * Batch upsert items.
 * Returns counts of stored and conflicted items.
 */
export function batchUpsert(
  tableName: string,
  items: SyncItem[],
): { stored: number, conflicts: SyncItem[] } {
  if (!db)
    throw new Error('Database not initialized')

  const stored: number[] = []
  const conflicts: SyncItem[] = []

  // Use a transaction for atomicity
  const transaction = db.transaction(() => {
    for (const item of items) {
      const existing = getItemById(tableName, item.id)

      if (existing && existing.updatedAt >= item.updatedAt) {
        // Server has newer version - this is a conflict
        conflicts.push(existing)
      }
      else {
        // Insert/update the item
        const columns = getTableColumns(tableName)
        const values = buildRowValues(item, columns)
        const placeholders = columns.map(() => '?').join(', ')

        const [insertError] = tryCatchSync(() =>
          db!.prepare(
            `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
          ).run(...values),
        )
        if (insertError) {
          throw new Error(`Failed to insert item in batch: ${insertError.message}`)
        }

        stored.push(1)
      }
    }
  })

  transaction()

  return {
    stored: stored.length,
    conflicts,
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get column names for a table.
 */
function getTableColumns(tableName: string): string[] {
  switch (tableName) {
    case 'todos':
      return ['id', 'text', 'completed', 'created_at', 'updated_at', 'device_id', 'deleted']
    case 'projects':
      return ['id', 'name', 'color', 'created_at', 'updated_at', 'device_id', 'deleted']
    default:
      throw new Error(`Unknown table: ${tableName}`)
  }
}

/**
 * Get metadata value from SyncItem for a column.
 */
function getMetadataValue(item: SyncItem, col: string): unknown {
  const metadataMap: Record<string, unknown> = {
    id: item.id,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    device_id: item.deviceId,
    deleted: item.deleted ? 1 : 0,
  }
  return metadataMap[col]
}

/**
 * Convert a data field value for SQLite storage.
 */
function convertDataValue(value: unknown): unknown {
  if (typeof value === 'boolean')
    return value ? 1 : 0
  if (typeof value === 'object' && value !== null)
    return JSON.stringify(value)
  return value
}

/**
 * Build row values from a SyncItem.
 */
function buildRowValues(item: SyncItem, columns: string[]): unknown[] {
  return columns.map((col) => {
    const metadataValue = getMetadataValue(item, col)
    if (metadataValue !== undefined)
      return metadataValue
    return convertDataValue(item.data[col])
  })
}

function getString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function getNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' ? value : 0
}

/**
 * Convert a database row to SyncItem.
 */
function rowToSyncItem(row: Record<string, unknown>): SyncItem {
  const id = getString(row, 'id')
  const createdAt = getNumber(row, 'created_at')
  const updatedAt = getNumber(row, 'updated_at')
  const deviceId = getString(row, 'device_id')
  const deleted = row.deleted === 1

  // Extract data fields
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (!['id', 'created_at', 'updated_at', 'device_id', 'deleted'].includes(key)) {
      // Convert SQLite integers back to booleans for known boolean fields
      if (key === 'completed' && typeof value === 'number') {
        data[key] = value === 1
      }
      else {
        data[key] = value
      }
    }
  }

  return {
    id,
    data,
    createdAt,
    updatedAt,
    deviceId,
    deleted,
  }
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
