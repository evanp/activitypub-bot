import { describe, after, it } from 'node:test'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import Logger from 'pino'

import { DomainBlocker } from '../lib/domainblocker.js'
import { createMigratedTestConnection } from './utils/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => resolve(__dirname, 'fixtures', name)

const logger = new Logger({ level: 'silent' })

const BASIC = fixture('blocklist-basic.csv')
const SUBSET = fixture('blocklist-subset.csv')

describe('DomainBlocker', async () => {
  const connections = []

  async function migratedConnection () {
    const connection = await createMigratedTestConnection()
    connections.push(connection)
    return connection
  }

  async function initializedBlocker (filename, connection) {
    const blocker = new DomainBlocker(filename, connection, logger)
    await blocker.initialize()
    return blocker
  }

  after(async () => {
    for (const connection of connections) {
      await connection.close()
    }
  })

  it('can construct and initialize', async () => {
    const connection = await migratedConnection()
    const blocker = new DomainBlocker(BASIC, connection, logger)
    assert.ok(blocker)
    await blocker.initialize()
  })

  it('blocks an exact blocked domain', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://blocked-one.test/users/alice'),
      true
    )
  })

  it('blocks a second suspend-severity domain', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://blocked-two.test/users/bob'),
      true
    )
  })

  it('blocks a subdomain of a blocked domain (suffix match)', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://mastodon.blocked-one.test/users/alice'),
      true
    )
    assert.strictEqual(
      await blocker.isBlocked('https://a.b.blocked-one.test/users/alice'),
      true
    )
  })

  it('does not block an unrelated domain', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://allowed.test/users/carol'),
      false
    )
  })

  it('does not block a domain that only contains a blocked domain as a suffix substring', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://notblocked-one.test/users/dave'),
      false
    )
  })

  it('matches domains case-insensitively', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://mixed-case.test/users/erin'),
      true
    )
    assert.strictEqual(
      await blocker.isBlocked('https://MIXED-CASE.test/users/erin'),
      true
    )
  })

  it('ignores rows whose severity is not suspend', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://silenced.test/users/frank'),
      false
    )
    assert.strictEqual(
      await blocker.isBlocked('https://noop-domain.test/users/grace'),
      false
    )
  })

  it('tolerates a masked (asterisk) domain row and still blocks the valid rows', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await blocker.isBlocked('https://blocked-one.test/users/alice'),
      true
    )
  })

  it('initialize is idempotent and keeps existing blocks', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    await blocker.initialize()
    assert.strictEqual(
      await blocker.isBlocked('https://blocked-one.test/users/alice'),
      true
    )
  })

  it('syncing a smaller list removes domains no longer present', async () => {
    const connection = await migratedConnection()
    const first = await initializedBlocker(BASIC, connection)
    assert.strictEqual(
      await first.isBlocked('https://blocked-two.test/users/bob'),
      true
    )

    await initializedBlocker(SUBSET, connection)

    const after = new DomainBlocker(SUBSET, connection, logger)
    assert.strictEqual(
      await after.isBlocked('https://blocked-two.test/users/bob'),
      false
    )
    assert.strictEqual(
      await after.isBlocked('https://blocked-one.test/users/alice'),
      true
    )
  })
})
