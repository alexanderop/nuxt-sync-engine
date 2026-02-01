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

/**
 * Type guard to check if an error is a DOMException.
 * Uses structural checking to avoid type assertions.
 */
function isDOMException(error: unknown): error is DOMException {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  // Check for DOMException-like structure
  const hasName = 'name' in error && typeof error.name === 'string'
  const hasMessage = 'message' in error && typeof error.message === 'string'

  return hasName && hasMessage
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
