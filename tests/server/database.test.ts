import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'

describe('better-sqlite3 native module', () => {
  let db: Database.Database

  afterAll(() => db?.close())

  it('should load native bindings', () => {
    expect(() => {
      db = new Database(':memory:')
    }).not.toThrow()
  })

  it('should execute SQL and support transactions', () => {
    db.exec('CREATE TABLE test (id TEXT, value TEXT)')
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO test VALUES (?, ?)').run('1', 'hello')
    })
    tx()
    const row = db.prepare('SELECT * FROM test').get()
    expect(row).toEqual({ id: '1', value: 'hello' })
  })
})
