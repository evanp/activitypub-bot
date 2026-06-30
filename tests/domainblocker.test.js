import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import Logger from 'pino'

import { DomainBlocker } from '../lib/domainblocker.js'
import as2 from '../lib/activitystreams.js'
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

  it('with no file, skips the sync and keeps the existing domain blocks', async () => {
    const connection = await migratedConnection()
    await connection.query(
      'INSERT INTO domain_block (domain_name) VALUES (?)',
      { replacements: ['preexisting.test'] }
    )

    const blocker = new DomainBlocker(null, connection, logger)
    await blocker.initialize()

    assert.strictEqual(
      await blocker.isBlocked('https://preexisting.test/users/heidi'),
      true
    )
    assert.strictEqual(
      await blocker.isBlocked('https://allowed.test/users/ivan'),
      false
    )
  })

  it('returns false (without throwing) for a non-URL id', async () => {
    const connection = await migratedConnection()
    const blocker = await initializedBlocker(BASIC, connection)
    assert.strictEqual(await blocker.isBlocked('Note'), false)
    assert.strictEqual(await blocker.isBlocked('_:blanknode'), false)
  })

  describe('isBlockedObject', async () => {
    let blocker = null

    before(async () => {
      const connection = await migratedConnection()
      blocker = await initializedBlocker(BASIC, connection)
    })

    it('is true when the object\'s own id is blocked', async () => {
      const obj = await as2.import({
        id: 'https://blocked-one.test/notes/1',
        type: 'Note'
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is true when the activity actor is blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/activities/1',
        type: 'Create',
        actor: 'https://blocked-one.test/users/alice',
        object: { id: 'https://allowed.test/notes/1', type: 'Note' }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is true when a wrapped object is blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/activities/2',
        type: 'Announce',
        actor: 'https://allowed.test/users/relay',
        object: { id: 'https://blocked-two.test/notes/9', type: 'Note' }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is true when attributedTo is blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/notes/2',
        type: 'Note',
        attributedTo: 'https://blocked-one.test/users/bob'
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is true when inReplyTo is blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/notes/3',
        type: 'Note',
        attributedTo: 'https://allowed.test/users/carol',
        inReplyTo: 'https://blocked-one.test/notes/x'
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is true when context is blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/notes/4',
        type: 'Note',
        context: 'https://blocked-two.test/contexts/y'
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is true for a deeply nested blocked object', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/activities/3',
        type: 'Announce',
        actor: 'https://allowed.test/users/relay',
        object: {
          id: 'https://allowed.test/activities/4',
          type: 'Create',
          actor: 'https://allowed.test/users/relay',
          object: { id: 'https://blocked-one.test/notes/deep', type: 'Note' }
        }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is false when no id in the graph is blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/activities/5',
        type: 'Create',
        actor: 'https://allowed.test/users/dave',
        object: {
          id: 'https://allowed.test/notes/5',
          type: 'Note',
          attributedTo: 'https://allowed.test/users/dave'
        }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), false)
    })

    it('is true for a Link whose href is blocked', async () => {
      const link = await as2.import({
        type: 'Link',
        href: 'https://blocked-two.test/something'
      })
      assert.strictEqual(await blocker.isBlockedObject(link), true)
    })

    it('is true when a Mention tag href is blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/notes/6',
        type: 'Note',
        attributedTo: 'https://allowed.test/users/carol',
        tag: {
          type: 'Mention',
          href: 'https://blocked-one.test/users/victim',
          name: '@victim@blocked-one.test'
        }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('is false when a Mention tag href is not blocked', async () => {
      const obj = await as2.import({
        id: 'https://allowed.test/notes/7',
        type: 'Note',
        attributedTo: 'https://allowed.test/users/carol',
        tag: {
          type: 'Mention',
          href: 'https://allowed.test/users/friend',
          name: '@friend@allowed.test'
        }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), false)
    })

    it('is true when a Hashtag tag href is blocked', async () => {
      const obj = await as2.import({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://purl.archive.org/miscellany'
        ],
        id: 'https://allowed.test/notes/8',
        type: 'Note',
        attributedTo: 'https://allowed.test/users/carol',
        tag: {
          type: 'Hashtag',
          href: 'https://blocked-one.test/tags/example',
          name: '#example'
        }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })

    it('does not throw on a Delete of a Tombstone with a formerType', async () => {
      const obj = await as2.import({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://purl.archive.org/miscellany'
        ],
        id: 'https://allowed.test/activities/del1',
        type: 'Delete',
        actor: 'https://allowed.test/users/alice',
        object: {
          type: 'Tombstone',
          id: 'https://allowed.test/notes/1',
          formerType: 'Note'
        }
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), false)
    })

    it('still blocks a Tombstone whose id is on a blocked domain', async () => {
      const obj = await as2.import({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://purl.archive.org/miscellany'
        ],
        type: 'Tombstone',
        id: 'https://blocked-one.test/notes/deleted',
        formerType: 'Note'
      })
      assert.strictEqual(await blocker.isBlockedObject(obj), true)
    })
  })
})
