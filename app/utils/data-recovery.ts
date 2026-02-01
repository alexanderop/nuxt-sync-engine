/**
 * IndexedDB Data Recovery Utilities
 * ==================================
 *
 * Tools for validating and repairing corrupted data in IndexedDB stores.
 * This is essential for local-first apps where data integrity is critical.
 */

import { getAllRecords, putRecord } from '~/utils/idb-helpers'

/**
 * Result of a validation and repair operation.
 */
export interface RecoveryResult {
  /** Number of items that were successfully repaired */
  repaired: number
  /** List of error messages for items that could not be repaired */
  errors: string[]
}

/**
 * Store names that contain syncable data.
 */
const SYNCABLE_STORES = ['todos', 'projects'] as const

/**
 * Type guard to check if a value is an object (non-null).
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard to check if an object has a string 'id' property.
 */
function hasStringId(obj: Record<string, unknown>): obj is Record<string, unknown> & { id: string } {
  return 'id' in obj && typeof obj.id === 'string' && obj.id.length > 0
}

/**
 * Validate an item and return a list of issues found.
 *
 * Checks for:
 * - Item is an object
 * - Item has a valid string 'id'
 * - Item has a valid 'updatedAt' timestamp
 *
 * @param item - The item to validate
 * @returns Array of issue descriptions (empty if valid)
 */
function validateItem(item: unknown): string[] {
  const issues: string[] = []

  // Check if item is an object
  if (!isObject(item)) {
    issues.push('Item is not an object')
    return issues
  }

  // Check for valid id
  if (!('id' in item)) {
    issues.push('Missing id property')
  }
  else if (typeof item.id !== 'string') {
    issues.push(`Invalid id type: expected string, got ${typeof item.id}`)
  }
  else if (item.id.length === 0) {
    issues.push('Empty id string')
  }

  // Check for valid updatedAt
  if (!('updatedAt' in item)) {
    issues.push('Missing updatedAt property')
  }
  else if (typeof item.updatedAt !== 'number') {
    issues.push(`Invalid updatedAt type: expected number, got ${typeof item.updatedAt}`)
  }
  else if (item.updatedAt <= 0) {
    issues.push('Invalid updatedAt value: must be positive')
  }
  else if (!Number.isFinite(item.updatedAt)) {
    issues.push('Invalid updatedAt value: not a finite number')
  }

  return issues
}

/**
 * Attempt to repair an item based on the issues found.
 *
 * Repairs:
 * - Invalid/missing updatedAt: Sets to current timestamp
 *
 * Cannot repair:
 * - Missing or invalid id: Returns null (item must be marked as corrupted)
 *
 * @param item - The item to repair (must be an object)
 * @param issues - List of issues from validateItem
 * @returns Repaired item, or null if repair is not possible
 */
function repairItem(
  item: Record<string, unknown>,
  issues: string[],
): Record<string, unknown> | null {
  // Check if id issues exist - these cannot be repaired
  const hasIdIssue = issues.some(
    issue =>
      issue.includes('Missing id')
      || issue.includes('Invalid id')
      || issue.includes('Empty id'),
  )

  if (hasIdIssue) {
    return null
  }

  // Create a copy to avoid mutating the original
  const repaired = { ...item }

  // Fix updatedAt issues
  const hasUpdatedAtIssue = issues.some(issue => issue.includes('updatedAt'))
  if (hasUpdatedAtIssue) {
    repaired.updatedAt = Date.now()
  }

  return repaired
}

/**
 * Save a repaired item back to the store.
 */
async function saveRepairedItem(
  db: IDBDatabase,
  storeName: string,
  item: Record<string, unknown>,
): Promise<void> {
  const writeTransaction = db.transaction(storeName, 'readwrite')
  const writeStore = writeTransaction.objectStore(storeName)
  await putRecord(writeStore, item)
}

/**
 * Process a single item that has validation issues.
 */
async function processItemWithIssues(
  db: IDBDatabase,
  storeName: string,
  item: Record<string, unknown>,
  issues: string[],
  result: RecoveryResult,
): Promise<void> {
  const itemId = hasStringId(item) ? item.id : 'unknown'
  const repaired = repairItem(item, issues)

  if (repaired !== null) {
    await handleRepairedItem(db, storeName, repaired, itemId, issues, result)
  }
  else {
    await handleCorruptedItem(db, storeName, item, itemId, issues, result)
  }
}

/**
 * Handle saving a successfully repaired item.
 */
async function handleRepairedItem(
  db: IDBDatabase,
  storeName: string,
  repaired: Record<string, unknown>,
  itemId: string,
  issues: string[],
  result: RecoveryResult,
): Promise<void> {
  try {
    await saveRepairedItem(db, storeName, repaired)
    result.repaired++
    console.info(`[Recovery] Repaired item ${itemId} in ${storeName}:`, issues.join(', '))
  }
  catch (writeError) {
    const errorMessage = writeError instanceof Error ? writeError.message : String(writeError)
    result.errors.push(`[${storeName}] Failed to save repaired item ${itemId}: ${errorMessage}`)
  }
}

/**
 * Handle marking an item as corrupted when it cannot be repaired.
 */
async function handleCorruptedItem(
  db: IDBDatabase,
  storeName: string,
  item: Record<string, unknown>,
  itemId: string,
  issues: string[],
  result: RecoveryResult,
): Promise<void> {
  try {
    const corrupted = { ...item, _corrupted: true }
    await saveRepairedItem(db, storeName, corrupted)
    result.errors.push(`[${storeName}] Item ${itemId} marked as corrupted: ${issues.join(', ')}`)
    console.warn(`[Recovery] Marked item ${itemId} as corrupted in ${storeName}:`, issues.join(', '))
  }
  catch (markError) {
    const errorMessage = markError instanceof Error ? markError.message : String(markError)
    result.errors.push(`[${storeName}] Failed to mark item ${itemId} as corrupted: ${errorMessage}`)
  }
}

/**
 * Process all items in a single store.
 */
async function processStore(
  db: IDBDatabase,
  storeName: string,
  result: RecoveryResult,
): Promise<void> {
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  const items = await getAllRecords<unknown>(store)

  for (const item of items) {
    const issues = validateItem(item)

    if (issues.length === 0) {
      continue
    }

    if (!isObject(item)) {
      result.errors.push(`[${storeName}] Non-object item found: ${String(item)}`)
      continue
    }

    await processItemWithIssues(db, storeName, item, issues, result)
  }
}

/**
 * Validate and repair all items in the syncable stores.
 *
 * This function:
 * 1. Iterates through 'todos' and 'projects' stores
 * 2. Validates each item for required fields
 * 3. Attempts to repair fixable issues
 * 4. Marks unfixable items with `_corrupted: true`
 *
 * @param db - The IndexedDB database instance
 * @returns Result containing count of repaired items and list of errors
 *
 * @example
 * ```typescript
 * const db = await openDatabase()
 * const result = await validateAndRepair(db)
 * console.info(`Repaired ${result.repaired} items`)
 * if (result.errors.length > 0) {
 *   console.warn('Unrecoverable errors:', result.errors)
 * }
 * ```
 */
export async function validateAndRepair(db: IDBDatabase): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    repaired: 0,
    errors: [],
  }

  for (const storeName of SYNCABLE_STORES) {
    if (!db.objectStoreNames.contains(storeName)) {
      continue
    }

    try {
      await processStore(db, storeName, result)
    }
    catch (storeError) {
      const errorMessage = storeError instanceof Error ? storeError.message : String(storeError)
      result.errors.push(`[${storeName}] Failed to process store: ${errorMessage}`)
      console.error(`[Recovery] Failed to process store ${storeName}:`, storeError)
    }
  }

  return result
}
