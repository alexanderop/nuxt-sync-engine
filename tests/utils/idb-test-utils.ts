/**
 * IndexedDB Test Utilities
 * ========================
 *
 * Test helpers for working with IndexedDB in Vitest browser mode tests.
 * Provides isolation between tests through unique database names and proper cleanup.
 *
 * @example
 * ```typescript
 * import { describe, it, expect } from 'vitest'
 * import { withTestDB } from '../utils/idb-test-utils'
 *
 * describe('my IndexedDB tests', () => {
 *   const getDB = withTestDB()
 *
 *   it('should store and retrieve data', async () => {
 *     const db = getDB()
 *     // use db...
 *   })
 * })
 * ```
 */

import { afterEach, beforeEach } from 'vitest'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Database version for test databases */
const TEST_DB_VERSION = 1

// =============================================================================
// DATABASE CREATION
// =============================================================================

/**
 * Generate a unique database name for test isolation.
 * Uses timestamp and random suffix to avoid conflicts between parallel tests.
 */
function generateTestDBName(): string {
  const timestamp = Date.now()
  const randomSuffix = Math.random().toString(36).slice(2)
  return `test-db-${timestamp}-${randomSuffix}`
}

/**
 * Create a fresh test database with a unique name.
 * Uses timestamp and random suffix to avoid conflicts between parallel tests.
 *
 * The database schema matches the Sync Engine's production schema:
 * - todos: Entity store with id keyPath
 * - projects: Entity store with id keyPath
 * - sessions: Session tracking with auto-increment rowID
 * - operations: Ordered operations with composite key [sessionRowId, idx]
 * - unsynced: Server sync tracking with auto-increment rowID
 * - sync_meta: Key-value metadata store
 *
 * @returns Promise resolving to an initialized IDBDatabase
 */
export async function createTestDB(): Promise<IDBDatabase> {
  const dbName = generateTestDBName()

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, TEST_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      createTestSchema(db)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.addEventListener('error', () => {
      reject(new Error(`Failed to create test database: ${request.error?.message}`))
    })

    request.onblocked = () => {
      reject(new Error('Test database creation blocked by other connections'))
    }
  })
}

/**
 * Create the test database schema matching the Sync Engine schema.
 */
function createTestSchema(db: IDBDatabase): void {
  // Entity stores
  if (!db.objectStoreNames.contains('todos')) {
    const todos = db.createObjectStore('todos', { keyPath: 'id' })
    todos.createIndex('by_updated_at', 'updatedAt')
    todos.createIndex('by_deleted', 'deleted')
  }

  if (!db.objectStoreNames.contains('projects')) {
    const projects = db.createObjectStore('projects', { keyPath: 'id' })
    projects.createIndex('by_updated_at', 'updatedAt')
  }

  // Session tracking (Jazz pattern)
  if (!db.objectStoreNames.contains('sessions')) {
    const sessions = db.createObjectStore('sessions', {
      autoIncrement: true,
      keyPath: 'rowID',
    })
    sessions.createIndex('by_entity', ['entityType', 'entityId'])
    sessions.createIndex('unique', ['entityType', 'entityId', 'sessionId'], {
      unique: true,
    })
  }

  // Operations store - ordered operations within sessions
  if (!db.objectStoreNames.contains('operations')) {
    db.createObjectStore('operations', {
      keyPath: ['sessionRowId', 'idx'],
    })
  }

  // Sync tracking
  if (!db.objectStoreNames.contains('unsynced')) {
    const unsynced = db.createObjectStore('unsynced', {
      autoIncrement: true,
      keyPath: 'rowID',
    })
    unsynced.createIndex('by_entity', 'entityId', { unique: true })
  }

  // Sync metadata
  if (!db.objectStoreNames.contains('sync_meta')) {
    db.createObjectStore('sync_meta', { keyPath: 'key' })
  }
}

// =============================================================================
// DATABASE CLEANUP
// =============================================================================

/**
 * Clean up a test database by closing and deleting it.
 * Handles the async nature of IndexedDB deletion properly.
 *
 * @param db - The IDBDatabase instance to clean up
 * @returns Promise that resolves when cleanup is complete
 */
export async function cleanupTestDB(db: IDBDatabase): Promise<void> {
  const dbName = db.name

  // Close the database connection first
  db.close()

  // Delete the database
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName)

    request.onsuccess = () => {
      resolve()
    }

    request.addEventListener('error', () => {
      reject(new Error(`Failed to delete test database: ${request.error?.message}`))
    })

    request.onblocked = () => {
      // Database is blocked but will eventually be deleted
      // This can happen if there are still pending transactions
      console.warn(`Test database ${dbName} deletion blocked, waiting...`)
    }
  })
}

// =============================================================================
// TEST HOOKS
// =============================================================================

/**
 * Vitest setup helper that creates a fresh DB before each test
 * and cleans up after each test.
 *
 * Returns a getter function that provides access to the current test's database.
 * The database is guaranteed to be initialized when the test runs.
 *
 * @example
 * ```typescript
 * describe('my tests', () => {
 *   const getDB = withTestDB()
 *
 *   it('should work', async () => {
 *     const db = getDB()
 *     // use db...
 *   })
 *
 *   it('gets a fresh database each time', async () => {
 *     const db = getDB()
 *     // This is a completely new, empty database
 *   })
 * })
 * ```
 *
 * @returns A getter function that returns the current test's IDBDatabase
 */
export function withTestDB(): () => IDBDatabase {
  let currentDB: IDBDatabase | null = null

  beforeEach(async () => {
    currentDB = await createTestDB()
  })

  afterEach(async () => {
    if (currentDB) {
      await cleanupTestDB(currentDB)
      currentDB = null
    }
  })

  return () => {
    if (!currentDB) {
      throw new Error('Test database not initialized. Make sure withTestDB() is called at the describe block level.')
    }
    return currentDB
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Promisify an IDBRequest for easier async/await usage in tests.
 *
 * @param request - The IDBRequest to promisify
 * @returns Promise resolving to the request result
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error))
  })
}

/**
 * Wait for a transaction to complete.
 *
 * @param transaction - The IDBTransaction to wait for
 * @returns Promise that resolves when the transaction completes
 */
export function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(transaction.error))
    transaction.addEventListener('abort', () => reject(new Error('Transaction aborted')))
  })
}

/**
 * Helper to add test data to a store.
 *
 * @param db - The database to add data to
 * @param storeName - The object store name
 * @param data - The data to add
 * @returns Promise resolving to the key of the added record
 */
export async function addTestData<T>(
  db: IDBDatabase,
  storeName: string,
  data: T,
): Promise<IDBValidKey> {
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  const request = store.add(data)

  await waitForTransaction(tx)
  return request.result
}

/**
 * Helper to get all records from a store.
 *
 * @param db - The database to read from
 * @param storeName - The object store name
 * @returns Promise resolving to all records in the store
 */
export async function getAllFromStore<T>(
  db: IDBDatabase,
  storeName: string,
): Promise<T[]> {
  const tx = db.transaction(storeName, 'readonly')
  const store = tx.objectStore(storeName)
  const request = store.getAll()

  return promisifyRequest(request)
}

/**
 * Helper to clear all data from a store.
 *
 * @param db - The database to clear
 * @param storeName - The object store name
 * @returns Promise that resolves when the store is cleared
 */
export async function clearStore(
  db: IDBDatabase,
  storeName: string,
): Promise<void> {
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  store.clear()

  await waitForTransaction(tx)
}
