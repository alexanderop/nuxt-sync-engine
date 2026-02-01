interface CacheEntry<T> {
  data: T
  timestamp: number
}

export class EntityCache {
  private cache: Map<string, CacheEntry<unknown>>
  private readonly maxAge: number

  constructor(maxAge: number = 5000) {
    this.cache = new Map()
    this.maxAge = maxAge
  }

  /**
   * Check if an entry is valid (exists and not expired).
   * Removes expired entries as a side effect.
   */
  private getValidEntry(key: string): CacheEntry<unknown> | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      return undefined
    }

    const isExpired = Date.now() - entry.timestamp > this.maxAge
    if (isExpired) {
      this.cache.delete(key)
      return undefined
    }

    return entry
  }

  get<T>(key: string): T | undefined {
    const entry = this.getValidEntry(key)
    if (!entry) {
      return undefined
    }
    // eslint-disable-next-line ts/consistent-type-assertions -- Cache stores unknown, caller provides type
    return entry.data as T
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  has(key: string): boolean {
    return this.getValidEntry(key) !== undefined
  }

  size(): number {
    return this.cache.size
  }
}
