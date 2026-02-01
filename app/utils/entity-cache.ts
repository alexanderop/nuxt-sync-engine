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

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      return undefined
    }

    const isExpired = Date.now() - entry.timestamp > this.maxAge

    if (isExpired) {
      this.cache.delete(key)
      return undefined
    }

    // eslint-disable-next-line ts/consistent-type-assertions -- Cache stores unknown, caller provides type
    return entry.data as T
  }

  set<T>(key: string, data: T): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    }
    this.cache.set(key, entry)
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)

    if (!entry) {
      return false
    }

    const isExpired = Date.now() - entry.timestamp > this.maxAge

    if (isExpired) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  size(): number {
    return this.cache.size
  }
}
