/**
 * IndexedDB Composable
 * ====================
 *
 * Core IndexedDB database initialization and management for the Sync Engine.
 * Implements session-based causal ordering patterns from Jazz framework.
 *
 * > **Jazz Pattern Adoption**
 * >
 * > This implementation adopts Jazz's IndexedDB patterns:
 * > - Session-based operation tracking (not LWW)
 * > - Composite keys for ordered operations
 * > - Server-only sync tracking (single peer)
 * > - Auto-increment rowIDs for stable joins
 */

import type { Ref, ShallowRef } from 'vue'
import type { SyncItem } from '../../shared/types'

// =============================================================================
// DATABASE CONFIGURATION
// =============================================================================

const DB_NAME = 'sync-engine'
const DB_VERSION = 1

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Session record for tracking edit sessions per entity.
 * Jazz pattern: Multiple sessions per entity for causal ordering.
 */
export interface SessionRecord {
  /** Auto-generated row ID (stable for joins) */
  rowID?: number
  /** Entity type (e.g., 'todos', 'projects') */
  entityType: string
  /** Entity ID */
  entityId: string
  /** Session ID (deviceId + timestamp + random) */
  sessionId: string
  /** Last operation index in this session */
  lastIdx: number
}

/**
 * Operation record within a session.
 * Jazz pattern: Ordered operations with composite key [sessionRowId, idx].
 */
export interface OperationRecord {
  /** Reference to session rowID */
  sessionRowId: number
  /** Operation index within the session */
  idx: number
  /** Operation type */
  operation: 'create' | 'update' | 'delete'
  /** The changes made */
  changes: Record<string, unknown>
  /** Timestamp when operation was made */
  madeAt: number
}

/**
 * Unsynced record for server-only sync tracking.
 * Jazz pattern: Track what the server needs to know about.
 */
export interface UnsyncedRecord {
  /** Auto-generated row ID */
  rowID?: number
  /** Entity ID that needs syncing */
  entityId: string
  /** When this was marked as unsynced */
  createdAt: number
}

/**
 * Sync metadata record for key-value storage.
 */
export interface SyncMetaRecord {
  /** Metadata key */
  key: string
  /** Metadata value */
  value: unknown
}

/**
 * Type mapping for all object stores in the database.
 */
export interface SyncEngineStores {
  todos: SyncItem
  projects: SyncItem
  sessions: SessionRecord
  operations: OperationRecord
  unsynced: UnsyncedRecord
  sync_meta: SyncMetaRecord
}

/**
 * Return type for the useIndexedDB composable.
 */
export interface UseIndexedDBReturn {
  /** The IndexedDB database instance (shallowRef to prevent deep reactivity) */
  db: ShallowRef<IDBDatabase | null>
  /** Whether the database is ready for use */
  isReady: Ref<boolean>
  /** Initialize the database (returns existing if already initialized) */
  init: () => Promise<IDBDatabase>
}

// =============================================================================
// MODULE STATE (Singleton pattern)
// =============================================================================

let dbInstance: IDBDatabase | null = null
let initPromise: Promise<IDBDatabase> | null = null

// =============================================================================
// COMPOSABLE
// =============================================================================

/**
 * IndexedDB composable for the Sync Engine.
 *
 * Uses shallowRef for the database object to prevent Vue's deep reactivity
 * from proxying IDBDatabase methods.
 *
 * @example
 * ```typescript
 * const { db, isReady, init } = useIndexedDB()
 *
 * // Wait for initialization
 * await init()
 *
 * // Use the database
 * if (isReady.value && db.value) {
 *   const tx = db.value.transaction('todos', 'readonly')
 *   // ...
 * }
 * ```
 */
export function useIndexedDB(): UseIndexedDBReturn {
  // Use shallowRef to prevent deep reactivity on IDBDatabase
  const db = shallowRef<IDBDatabase | null>(dbInstance)
  const isReady = ref(dbInstance !== null)

  /**
   * Initialize the IndexedDB database.
   * Creates all object stores and indexes on first run.
   * Returns existing database if already initialized.
   */
  async function init(): Promise<IDBDatabase> {
    // Return existing database if already initialized
    if (dbInstance) {
      db.value = dbInstance
      isReady.value = true
      return dbInstance
    }

    // Return pending initialization if in progress
    if (initPromise) {
      const database = await initPromise
      db.value = database
      isReady.value = true
      return database
    }

    // Start initialization
    initPromise = initializeDatabase()

    try {
      const database = await initPromise
      dbInstance = database
      db.value = database
      isReady.value = true
      return database
    }
    catch (error) {
      initPromise = null
      throw error
    }
  }

  return {
    db,
    isReady,
    init,
  }
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

/**
 * Initialize the IndexedDB database with all object stores.
 */
function initializeDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const database = request.result
      const oldVersion = event.oldVersion
      const newVersion = event.newVersion ?? DB_VERSION

      console.info(`[indexeddb] Upgrading from v${oldVersion} to v${newVersion}`)

      // Version 1: Initial schema
      if (oldVersion < 1) {
        createInitialSchema(database)
      }

      // Future versions: Add migrations here
      // if (oldVersion < 2) {
      //   migrateToVersion2(database)
      // }
    }

    request.onsuccess = () => {
      console.info('[indexeddb] Database initialized successfully')
      resolve(request.result)
    }

    request.onerror = () => {
      console.error('[indexeddb] Failed to open database:', request.error)
      reject(request.error)
    }

    request.onblocked = () => {
      console.warn('[indexeddb] Database upgrade blocked - close other tabs')
    }
  })
}

/**
 * Create the initial database schema (version 1).
 */
function createInitialSchema(database: IDBDatabase): void {
  // =========================================================================
  // Entity Stores
  // =========================================================================

  // Todos store
  if (!database.objectStoreNames.contains('todos')) {
    const todos = database.createObjectStore('todos', { keyPath: 'id' })
    todos.createIndex('by_updated_at', 'updatedAt')
    todos.createIndex('by_deleted', 'deleted')
    console.info('[indexeddb] Created "todos" store')
  }

  // Projects store
  if (!database.objectStoreNames.contains('projects')) {
    const projects = database.createObjectStore('projects', { keyPath: 'id' })
    projects.createIndex('by_updated_at', 'updatedAt')
    console.info('[indexeddb] Created "projects" store')
  }

  // =========================================================================
  // Session Tracking (Jazz pattern)
  // =========================================================================

  // Sessions store - tracks edit sessions per entity
  if (!database.objectStoreNames.contains('sessions')) {
    const sessions = database.createObjectStore('sessions', {
      autoIncrement: true,
      keyPath: 'rowID',
    })
    // Index for finding all sessions for an entity
    sessions.createIndex('by_entity', ['entityType', 'entityId'])
    // Unique index for finding specific session
    sessions.createIndex('unique', ['entityType', 'entityId', 'sessionId'], {
      unique: true,
    })
    console.info('[indexeddb] Created "sessions" store')
  }

  // Operations store - ordered operations within sessions
  if (!database.objectStoreNames.contains('operations')) {
    // Composite key: [sessionRowId, idx] for ordered operations
    database.createObjectStore('operations', {
      keyPath: ['sessionRowId', 'idx'],
    })
    console.info('[indexeddb] Created "operations" store')
  }

  // =========================================================================
  // Sync Tracking
  // =========================================================================

  // Unsynced store - server-only sync tracking
  if (!database.objectStoreNames.contains('unsynced')) {
    const unsynced = database.createObjectStore('unsynced', {
      autoIncrement: true,
      keyPath: 'rowID',
    })
    // Unique index on entityId - each entity can only be unsynced once
    unsynced.createIndex('by_entity', 'entityId', { unique: true })
    console.info('[indexeddb] Created "unsynced" store')
  }

  // Sync metadata store - key-value for sync state
  if (!database.objectStoreNames.contains('sync_meta')) {
    database.createObjectStore('sync_meta', { keyPath: 'key' })
    console.info('[indexeddb] Created "sync_meta" store')
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Delete the database (for testing or reset).
 */
export async function deleteDatabase(): Promise<void> {
  // Close existing connection
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
  initPromise = null

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => {
      console.info('[indexeddb] Database deleted')
      resolve()
    }
    request.onerror = () => {
      console.error('[indexeddb] Failed to delete database:', request.error)
      reject(request.error)
    }
    request.onblocked = () => {
      console.warn('[indexeddb] Database deletion blocked - close all tabs')
    }
  })
}

/**
 * Promisify an IDBRequest.
 * Utility for working with IndexedDB's callback-based API.
 */
export function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get the database name constant.
 */
export function getDBName(): string {
  return DB_NAME
}

/**
 * Get the database version constant.
 */
export function getDBVersion(): number {
  return DB_VERSION
}
