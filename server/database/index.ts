/**
 * Server Database Module
 * ======================
 *
 * SQLite database for the sync server using better-sqlite3.
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
import Database from 'better-sqlite3'

// =============================================================================
// DATABASE INSTANCE
// =============================================================================

let db: Database.Database | null = null

/**
 * Get the database instance, initializing if needed.
 */
export async function getDatabase(): Promise<Database.Database> {
  if (db)
    return db

  // Create data directory
  await mkdir('data', { recursive: true })

  // Initialize database with WAL mode for performance
  db = new Database('data/sync.db')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  // Create tables
  db.exec(`
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
  `)

  console.log('[db] Server database initialized')
  return db
}

// =============================================================================
// SYNC OPERATIONS
// =============================================================================

/**
 * Get changes since a timestamp, excluding a specific device.
 */
export function getChangesSince(
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

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]
  return rows.map(rowToSyncItem)
}

/**
 * Get a single item by ID.
 */
export function getItemById(tableName: string, id: string): SyncItem | null {
  if (!db)
    throw new Error('Database not initialized')

  const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined

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

  db.prepare(
    `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
  ).run(...values)

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

        db!
          .prepare(
            `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
          )
          .run(...values)

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
 * Build row values from a SyncItem.
 */
function buildRowValues(item: SyncItem, columns: string[]): unknown[] {
  const values: unknown[] = []

  for (const col of columns) {
    switch (col) {
      case 'id':
        values.push(item.id)
        break
      case 'created_at':
        values.push(item.createdAt)
        break
      case 'updated_at':
        values.push(item.updatedAt)
        break
      case 'device_id':
        values.push(item.deviceId)
        break
      case 'deleted':
        values.push(item.deleted ? 1 : 0)
        break
      default: {
        // Data field
        const value = item.data[col]
        if (typeof value === 'boolean') {
          values.push(value ? 1 : 0)
        }
        else if (typeof value === 'object' && value !== null) {
          values.push(JSON.stringify(value))
        }
        else {
          values.push(value)
        }
      }
    }
  }

  return values
}

/**
 * Convert a database row to SyncItem.
 */
function rowToSyncItem(row: Record<string, unknown>): SyncItem {
  const id = row.id as string
  const createdAt = row.created_at as number
  const updatedAt = row.updated_at as number
  const deviceId = row.device_id as string
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
