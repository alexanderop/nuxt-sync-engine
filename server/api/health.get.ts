interface VersionRow {
  version: string
}

function hasVersionProperty(row: object): row is { version: unknown } {
  return 'version' in row
}

function isVersionRow(row: unknown): row is VersionRow {
  if (typeof row !== 'object' || row === null)
    return false
  if (!hasVersionProperty(row))
    return false
  return typeof row.version === 'string'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  return String(error)
}

export default defineEventHandler(async () => {
  try {
    const db = await getDatabase()
    const row = db.prepare('SELECT sqlite_version() as version').get()
    const version = isVersionRow(row) ? row.version : 'unknown'
    return { status: 'ok', sqlite: version, timestamp: Date.now() }
  }
  catch (error) {
    return { status: 'error', error: getErrorMessage(error) }
  }
})
