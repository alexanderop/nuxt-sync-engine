/**
 * Local Database Composable
 * =========================
 *
 * Manages SQLite in the browser using sql.js with OPFS persistence.
 * Provides a Jazz-like reactive database interface.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz uses a sophisticated storage layer:
 * > - Content-addressed storage (like Git)
 * > - Efficient binary encoding
 * > - Incremental sync with minimal data transfer
 * > - Automatic garbage collection
 * >
 * > We use a simpler SQL-based approach.
 */

import type { Database, SqlJsStatic } from 'sql.js'
import type { SyncItem } from '../../shared/types'
import initSqlJs from 'sql.js'
import { generateAllSchemaSql } from '../../utils/schema'

// =============================================================================
// MODULE STATE
// =============================================================================

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let fileHandle: FileSystemFileHandle | null = null
let isInitialized = false
let initPromise: Promise<Database> | null = null

const DB_FILENAME = 'sync-engine.db'

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

/**
 * Initialize and return the local SQLite database.
 * Uses OPFS for persistence when available.
 *
 * @example
 * ```typescript
 * const db = await useLocalDatabase();
 * ```
 */
export async function useLocalDatabase(): Promise<Database> {
  // Return existing database if already initialized
  if (db && isInitialized)
    return db

  // Return pending initialization if in progress
  if (initPromise)
    return initPromise

  // Start initialization
  initPromise = initializeDatabase()
  return initPromise
}

async function initializeDatabase(): Promise<Database> {
  // Initialize sql.js WASM (only once)
  if (!SQL) {
    console.log('[db] Loading sql.js WASM...')
    SQL = await initSqlJs({
      // Use local WASM file (copied by setup:wasm script)
      locateFile: file => `/wasm/${file}`,
    })
    console.log('[db] sql.js loaded')
  }

  // Check for OPFS support
  const hasOPFS
    = typeof navigator !== 'undefined'
      && 'storage' in navigator
      && typeof navigator.storage.getDirectory === 'function'

  if (!hasOPFS) {
    console.warn('[db] OPFS not supported, using in-memory database only')
    db = new SQL.Database()
    initializeSchema(db)
    isInitialized = true
    return db
  }

  try {
    // Get OPFS root directory
    const opfsRoot = await navigator.storage.getDirectory()
    fileHandle = await opfsRoot.getFileHandle(DB_FILENAME, { create: true })

    // Try to load existing database
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()

    if (buffer.byteLength > 0) {
      // Load existing database
      db = new SQL.Database(new Uint8Array(buffer))
      console.log('[db] Loaded existing database from OPFS')

      // Ensure schema is up to date
      initializeSchema(db)
    }
    else {
      // Create new database with schema
      db = new SQL.Database()
      initializeSchema(db)
      await persistDatabase()
      console.log('[db] Created new database in OPFS')
    }
  }
  catch (error) {
    console.error('[db] OPFS error, falling back to in-memory:', error)
    db = new SQL.Database()
    initializeSchema(db)
  }

  isInitialized = true
  return db
}

/**
 * Initialize the database schema.
 * Creates tables for all registered schemas.
 */
function initializeSchema(database: Database): void {
  // Create sync metadata table
  database.run(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Generate and run schema SQL for all entities
  const schemaSql = generateAllSchemaSql()
  database.run(schemaSql)

  console.log('[db] Schema initialized')
}

/**
 * Persist the database to OPFS.
 * Call this after making changes.
 */
export async function persistDatabase(): Promise<void> {
  if (!db || !fileHandle)
    return

  try {
    const data = db.export()
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
  }
  catch (error) {
    console.error('[db] Failed to persist database:', error)
    throw error
  }
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Run a query and return all results as typed objects.
 *
 * @example
 * ```typescript
 * const todos = queryAll<TodoRow>('SELECT * FROM todos WHERE deleted = 0');
 * ```
 */
export function queryAll<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): T[] {
  if (!db)
    throw new Error('Database not initialized')

  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const results: T[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T)
    }
    return results
  }
  finally {
    stmt.free() // CRITICAL: Always free prepared statements
  }
}

/**
 * Run a query and return the first result (or null).
 *
 * @example
 * ```typescript
 * const todo = queryOne<TodoRow>('SELECT * FROM todos WHERE id = ?', [id]);
 * ```
 */
export function queryOne<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): T | null {
  const results = queryAll<T>(sql, params)
  return results[0] ?? null
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE).
 *
 * @example
 * ```typescript
 * execute('UPDATE todos SET completed = ? WHERE id = ?', [1, id]);
 * ```
 */
export function execute(sql: string, params: unknown[] = []): void {
  if (!db)
    throw new Error('Database not initialized')
  db.run(sql, params)
}

// =============================================================================
// SYNC OPERATIONS
// =============================================================================

/**
 * Get the last sync timestamp.
 */
export function getLastSyncAt(): number {
  const result = queryOne<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    ['last_sync_at'],
  )
  return result ? Number.parseInt(result.value, 10) : 0
}

/**
 * Save the last sync timestamp.
 */
export function setLastSyncAt(timestamp: number): void {
  execute(
    'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
    ['last_sync_at', timestamp.toString()],
  )
}

/**
 * Get all changes since a given timestamp for a table.
 */
export function getChangesSince(
  tableName: string,
  since: number,
): SyncItem[] {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM ${tableName} WHERE updated_at > ? ORDER BY updated_at ASC`,
    [since],
  )

  return rows.map(row => rowToSyncItem(row))
}

/**
 * Get a specific item by ID.
 */
export function getItemById(
  tableName: string,
  id: string,
): SyncItem | null {
  const row = queryOne<Record<string, unknown>>(
    `SELECT * FROM ${tableName} WHERE id = ?`,
    [id],
  )

  return row ? rowToSyncItem(row) : null
}

/**
 * Insert or update an item (upsert).
 */
export function upsertItem(tableName: string, item: SyncItem): void {
  // Get existing item to preserve created_at
  const existing = getItemById(tableName, item.id)
  const createdAt = existing?.createdAt ?? item.createdAt

  // Build the data columns and values
  const dataColumns = Object.keys(item.data)
  const allColumns = ['id', 'created_at', 'updated_at', 'device_id', 'deleted', ...dataColumns]

  const values: unknown[] = [
    item.id,
    createdAt,
    item.updatedAt,
    item.deviceId,
    item.deleted ? 1 : 0,
  ]

  // Add data values
  for (const col of dataColumns) {
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

  const placeholders = allColumns.map(() => '?').join(', ')

  execute(
    `INSERT OR REPLACE INTO ${tableName} (${allColumns.join(', ')}) VALUES (${placeholders})`,
    values,
  )
}

/**
 * Get all non-deleted items from a table.
 */
export function getAllItems(tableName: string): SyncItem[] {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM ${tableName} WHERE deleted = 0 ORDER BY updated_at DESC`,
  )

  return rows.map(row => rowToSyncItem(row))
}

// =============================================================================
// ROW CONVERSION HELPERS
// =============================================================================

/**
 * Convert a database row to a SyncItem.
 */
function rowToSyncItem(row: Record<string, unknown>): SyncItem {
  // Extract metadata columns
  const id = row.id as string
  const createdAt = row.created_at as number
  const updatedAt = row.updated_at as number
  const deviceId = row.device_id as string
  const deleted = row.deleted === 1

  // Extract data columns (everything else)
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (!['id', 'created_at', 'updated_at', 'device_id', 'deleted'].includes(key)) {
      // Convert SQLite integers back to booleans if needed
      // (we can't know the original type, so we keep as-is)
      data[key] = value
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
 * Convert a SyncItem to database row format.
 */
export function syncItemToRow(item: SyncItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: item.id,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    device_id: item.deviceId,
    deleted: item.deleted ? 1 : 0,
  }

  // Add data fields
  for (const [key, value] of Object.entries(item.data)) {
    if (typeof value === 'boolean') {
      row[key] = value ? 1 : 0
    }
    else if (typeof value === 'object' && value !== null) {
      row[key] = JSON.stringify(value)
    }
    else {
      row[key] = value
    }
  }

  return row
}

// =============================================================================
// DATABASE UTILITIES
// =============================================================================

/**
 * Check if the database is initialized.
 */
export function isDatabaseReady(): boolean {
  return isInitialized && db !== null
}

/**
 * Close and reset the database (for testing).
 */
export async function resetDatabase(): Promise<void> {
  if (db) {
    db.close()
    db = null
  }
  isInitialized = false
  initPromise = null

  // Delete OPFS file
  if (fileHandle) {
    try {
      const opfsRoot = await navigator.storage.getDirectory()
      await opfsRoot.removeEntry(DB_FILENAME)
    }
    catch {
      // Ignore errors
    }
    fileHandle = null
  }
}

/**
 * Get database statistics.
 */
export function getDatabaseStats(): {
  tables: Array<{ name: string, count: number }>
  totalSize: number
} {
  if (!db)
    throw new Error('Database not initialized')

  // Get table names
  const tables = queryAll<{ name: string }>(
    'SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\'',
  )

  const stats = tables.map((t) => {
    const countResult = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${t.name}`,
    )
    return {
      name: t.name,
      count: countResult?.count ?? 0,
    }
  })

  // Get total database size
  const data = db.export()

  return {
    tables: stats,
    totalSize: data.byteLength,
  }
}
