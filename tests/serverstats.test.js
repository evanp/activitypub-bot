import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import as2 from '../lib/activitystreams.js'
import { KeyStorage } from '../lib/keystorage.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ServerStats } from '../lib/serverstats.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const LOCAL_HOST = 'local.serverstats.test'
const ORIGIN = `https://${LOCAL_HOST}`
const USER_A = 'serverstatsuser_a'
const USER_B = 'serverstatsuser_b'
const USER_C = 'serverstatsuser_c'
const TEST_USERNAMES = [USER_A, USER_B, USER_C]

describe('ServerStats', async () => {
  let connection = null
  let keyStorage = null
  let actorStorage = null
  let formatter = null
  let logger = null
  let stats = null

  before(async () => {
    logger = Logger({ level: 'silent' })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: []
    })
    formatter = new UrlFormatter(ORIGIN)
    keyStorage = new KeyStorage(connection, logger)
    actorStorage = new ActorStorage(connection, formatter)

    await keyStorage.getPublicKey(USER_A)
    await keyStorage.getPublicKey(USER_B)
    await keyStorage.getPublicKey(USER_C)

    const recent = await as2.import({
      id: `${ORIGIN}/user/${USER_A}/note/1`,
      type: 'Note',
      content: 'recent note'
    })
    await actorStorage.addToCollection(USER_A, 'outbox', recent)

    const old = await as2.import({
      id: `${ORIGIN}/user/${USER_B}/note/1`,
      type: 'Note',
      content: 'older note'
    })
    await actorStorage.addToCollection(USER_B, 'outbox', old)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    await connection.query(
      `UPDATE actorcollectionpage SET createdat = ? WHERE username = ? AND property = 'outbox'`,
      { replacements: [sixtyDaysAgo, USER_B] }
    )
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: []
    })
    await connection.query('DELETE FROM server_stats WHERE domain = ?',
      { replacements: [LOCAL_HOST] })
    await connection.close()
  })

  it('can be constructed', () => {
    stats = new ServerStats(keyStorage, actorStorage, LOCAL_HOST, connection)
    assert.ok(stats)
  })

  it('get() returns computed stats on first call', async () => {
    await connection.query('DELETE FROM server_stats WHERE domain = ?',
      { replacements: [LOCAL_HOST] })
    const result = await stats.get()
    assert.strictEqual(typeof result, 'object')
    assert.ok(Number.isInteger(result.totalUsers))
    assert.ok(Number.isInteger(result.activeMonthly))
    assert.ok(Number.isInteger(result.activeHalfYearly))
    assert.ok(result.totalUsers >= 3, `totalUsers (${result.totalUsers}) should be >= 3`)
    assert.ok(result.activeMonthly >= 1, `activeMonthly (${result.activeMonthly}) should be >= 1`)
    assert.ok(result.activeHalfYearly >= result.activeMonthly,
      `activeHalfYearly (${result.activeHalfYearly}) should be >= activeMonthly (${result.activeMonthly})`)
  })

  it('get() persists a row to server_stats', async () => {
    await stats.get()
    const [rows] = await connection.query(
      'SELECT COUNT(*) AS n FROM server_stats WHERE domain = ?',
      { replacements: [LOCAL_HOST] }
    )
    const n = (typeof rows[0].n === 'string') ? parseInt(rows[0].n, 10) : rows[0].n
    assert.strictEqual(n, 1)
  })

  it('get() upserts on stale data (does not create duplicate rows)', async () => {
    await stats.get()
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await connection.query(
      'UPDATE server_stats SET updated_at = ? WHERE domain = ?',
      { replacements: [yesterday, LOCAL_HOST] }
    )
    await stats.get()
    const [rows] = await connection.query(
      'SELECT COUNT(*) AS n FROM server_stats WHERE domain = ?',
      { replacements: [LOCAL_HOST] }
    )
    const n = (typeof rows[0].n === 'string') ? parseInt(rows[0].n, 10) : rows[0].n
    assert.strictEqual(n, 1, `expected one row for ${LOCAL_HOST}, got ${n}`)
  })
})
