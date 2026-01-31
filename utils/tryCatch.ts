type Success<T> = [null, T]
type Failure = [Error, null]
type Result<T> = Success<T> | Failure

/**
 * Wraps an async function in a try-catch and returns a tuple.
 * Inspired by Go/Rust error handling patterns.
 *
 * @example
 * const [error, data] = await tryCatch(fetchUser(id))
 * if (error) {
 *   console.error('Failed to fetch user:', error.message)
 *   return
 * }
 * // data is typed and guaranteed non-null here
 */
export async function tryCatch<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    const data = await promise
    return [null, data]
  }
  catch (error) {
    return [error instanceof Error ? error : new Error(String(error)), null]
  }
}

/**
 * Wraps a synchronous function in a try-catch and returns a tuple.
 *
 * @example
 * const [error, parsed] = tryCatchSync(() => JSON.parse(jsonString))
 * if (error) {
 *   console.error('Invalid JSON:', error.message)
 *   return
 * }
 */
export function tryCatchSync<T>(fn: () => T): Result<T> {
  try {
    const data = fn()
    return [null, data]
  }
  catch (error) {
    return [error instanceof Error ? error : new Error(String(error)), null]
  }
}
