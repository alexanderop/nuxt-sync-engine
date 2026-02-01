/**
 * IndexedDB Error Handling Utilities
 * ===================================
 *
 * Safe wrappers for IndexedDB operations with proper error handling,
 * especially for quota exceeded errors which are common in local-first apps.
 */

/**
 * Options for safe IDB operations.
 */
export interface SafeIDBOptions {
  /** Callback when storage quota is exceeded */
  onQuotaExceeded?: () => void
}

/** Shape for structural DOMException checking */
interface DOMExceptionLike {
  code: number
  name: string
}

/**
 * Type guard to check if error has DOMException-like structure.
 */
function hasDOMExceptionShape(error: object): error is DOMExceptionLike {
  return (
    'code' in error
    && typeof error.code === 'number'
    && 'name' in error
    && typeof error.name === 'string'
  )
}

/**
 * Type guard to check if an error is a DOMException.
 * Uses instanceof check first, then falls back to structural checking
 * based on DOMException-specific properties.
 */
function isDOMException(error: unknown): error is DOMException {
  // Direct instanceof check (works in browser environments)
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return true
  }

  if (typeof error !== 'object' || error === null) {
    return false
  }

  // Fallback: DOMException has numeric 'code' property that Error doesn't have
  return hasDOMExceptionShape(error)
}

/**
 * Check if an error is a QuotaExceededError.
 */
function isQuotaExceededError(error: unknown): boolean {
  if (!isDOMException(error)) {
    return false
  }
  return error.name === 'QuotaExceededError'
}

/**
 * Log error details based on error type.
 */
function logError(error: unknown): void {
  if (isDOMException(error)) {
    console.error(`[IDB] DOMException (${error.name}):`, error.message)
  }
  else if (error instanceof Error) {
    console.error('[IDB] Error:', error.message)
  }
  else {
    console.error('[IDB] Unknown error:', error)
  }
}

/**
 * Safely execute an IndexedDB operation with error handling.
 *
 * This wrapper catches common IndexedDB errors and provides hooks for:
 * - QuotaExceededError: When storage limits are reached
 *
 * @param operation - The async operation to execute
 * @param options - Optional callbacks for specific error types
 * @returns The result of the operation
 * @throws Re-throws the error after handling
 *
 * @example
 * ```typescript
 * const result = await safeIDBOperation(
 *   () => putRecord(store, data),
 *   {
 *     onQuotaExceeded: () => {
 *       // Clear old data or notify user
 *       console.warn('Storage quota exceeded, clearing cache...')
 *     }
 *   }
 * )
 * ```
 */
export async function safeIDBOperation<T>(
  operation: () => Promise<T>,
  options?: SafeIDBOptions,
): Promise<T> {
  try {
    return await operation()
  }
  catch (error: unknown) {
    // Handle QuotaExceededError
    if (isQuotaExceededError(error)) {
      console.error('[IDB] QuotaExceededError: Storage quota exceeded', error)

      if (options?.onQuotaExceeded) {
        try {
          options.onQuotaExceeded()
        }
        catch (callbackError) {
          console.error('[IDB] Error in onQuotaExceeded callback:', callbackError)
        }
      }

      throw error
    }

    // Log other errors
    logError(error)

    throw error
  }
}
