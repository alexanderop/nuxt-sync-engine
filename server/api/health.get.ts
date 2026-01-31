import { getDatabase } from '../database'

export default defineEventHandler(async () => {
  try {
    const db = await getDatabase()
    const { version } = db.prepare('SELECT sqlite_version() as version').get() as { version: string }
    return { status: 'ok', sqlite: version, timestamp: Date.now() }
  }
  catch (error) {
    return { status: 'error', error: (error as Error).message }
  }
})
