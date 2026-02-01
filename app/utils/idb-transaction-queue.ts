export class IDBTransactionQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  async enqueue<T>(
    db: IDBDatabase,
    storeNames: string | string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const tx = db.transaction(storeNames, mode)
          const result = await operation(tx)
          resolve(result)
        }
        catch (error) {
          reject(error)
        }
      })

      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.running)
      return

    this.running = true

    while (this.queue.length > 0) {
      const task = this.queue.shift()
      if (task) {
        await task()
      }
    }

    this.running = false
  }
}

export const txQueue = new IDBTransactionQueue()
