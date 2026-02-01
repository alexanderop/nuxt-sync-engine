export function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get a single record from an index with proper typing.
 * The result type is determined by the caller's usage.
 */
export function getFromIndex<T>(
  index: IDBIndex,
  key: IDBValidKey | IDBKeyRange,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = index.get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get all records from an index with proper typing.
 */
export function getAllFromIndex<T>(
  index: IDBIndex,
  key?: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = key !== undefined ? index.getAll(key) : index.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Add a record and get the generated key with proper typing.
 */
export function addRecord(
  store: IDBObjectStore,
  value: unknown,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = store.add(value)
    request.onsuccess = () => {
      const result = request.result
      if (typeof result === 'number') {
        resolve(result)
      }
      else {
        resolve(Number(result))
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get a single record by key from an object store with proper typing.
 */
export function getRecord<T>(
  store: IDBObjectStore,
  key: IDBValidKey,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get all records from an object store with proper typing.
 */
export function getAllRecords<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Put (insert or update) a record in an object store.
 */
export function putRecord<T>(
  store: IDBObjectStore,
  value: T,
): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const request = store.put(value)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Transform a SyncItem to an entity by merging id with data.
 * The generic T must extend { id: string } to ensure type safety.
 */
export function syncItemToEntity<T extends { id: string }>(
  item: { id: string, data: Record<string, unknown> },
): T {
  const entity = { id: item.id, ...item.data }
  // eslint-disable-next-line ts/consistent-type-assertions -- Generic entity transformation from IndexedDB
  return entity as T
}

/**
 * Extract data from an entity for storage in SyncItem format.
 * Removes the 'id' field from the data since it's stored separately.
 */
export function entityToSyncData<T extends { id: string }>(
  entity: T,
): Record<string, unknown> {
  const { id: _id, ...rest } = entity
  return rest
}

/**
 * Build changes record from partial entity, excluding id.
 */
export function partialToChanges<T extends { id: string }>(
  partial: Partial<T>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  // Use Object.entries for proper typing without assertions
  for (const [key, value] of Object.entries(partial)) {
    if (key !== 'id') {
      changes[key] = value
    }
  }
  return changes
}
