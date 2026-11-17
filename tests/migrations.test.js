import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import { runMigrations } from '../lib/migrations/index.js'

import { createTestConnection } from './utils/db.js'

describe('migrations', async () => {
  let connection = null
  let appliedIds = null

  before(async () => {
    connection = createTestConnection()
    await connection.authenticate()
  })
  after(async () => {
    await connection.close()
  })
  it('can run all migrations on a new database', async () => {
    await runMigrations(connection)
  })
  it('records each migration exactly once', async () => {
    const [rows] = await connection.query('SELECT id FROM migrations')
    appliedIds = rows.map(row => row.id)
    assert.ok(appliedIds.length > 0)
    assert.strictEqual(new Set(appliedIds).size, appliedIds.length)
  })
  it('can run migrations again on the same database', async () => {
    await runMigrations(connection)
  })
  it('does not re-apply previously applied migrations', async () => {
    const [rows] = await connection.query('SELECT id FROM migrations')
    const ids = rows.map(row => row.id)
    assert.deepEqual([...ids].sort(), [...appliedIds].sort())
  })
})
