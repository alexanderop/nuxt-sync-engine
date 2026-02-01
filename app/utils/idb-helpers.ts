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
