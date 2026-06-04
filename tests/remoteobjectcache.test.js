import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const REMOTE_HOST = 'social.remoteobjectcache.test'

describe('RemoteObjectCache', async () => {
  const REMOTE_NOTE_ID = `https://${REMOTE_HOST}/user/testuser/note/1`
  const REMOTE_ACTOR_ID = `https://${REMOTE_HOST}/user/testactor`
  const TEST_USERNAME = 'remoteobjectcachetestbot'

  let connection = null
  let logger = null
  let cache = null

  before(async () => {
    logger = new Logger({ level: 'silent' })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: [TEST_USERNAME],
      remoteDomains: [REMOTE_HOST]
    })
    cache = new RemoteObjectCache(connection, logger)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: [TEST_USERNAME],
      remoteDomains: [REMOTE_HOST]
    })
    await connection.close()
  })

  it('get on a cold cache returns null', async () => {
    const result = await cache.get(REMOTE_NOTE_ID, TEST_USERNAME)
    assert.equal(result, null)
  })

  it('set with caching headers then get returns object with header-derived expiry', async () => {
    const noteObject = { id: REMOTE_NOTE_ID, type: 'Note', content: 'Hello' }
    const maxAge = 3600 // 1 hour in seconds
    const headers = new Headers({ 'cache-control': `max-age=${maxAge}` })
    await cache.set(REMOTE_NOTE_ID, TEST_USERNAME, noteObject, headers)

    const result = await cache.get(REMOTE_NOTE_ID, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, noteObject)
    assert.ok(result.expiry instanceof Date)
    const expectedExpiry = Date.now() + maxAge * 1000
    assert.ok(Math.abs(result.expiry.getTime() - expectedExpiry) < 1000)
  })

  it('set with no caching headers and an object with an inbox expires immediately', async () => {
    const actorObject = { id: REMOTE_ACTOR_ID, type: 'Person', name: 'Test Actor', inbox: `${REMOTE_ACTOR_ID}/inbox` }
    await cache.set(REMOTE_ACTOR_ID, TEST_USERNAME, actorObject, new Headers())

    const result = await cache.get(REMOTE_ACTOR_ID, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, actorObject)
    assert.ok(result.expiry instanceof Date)
    assert.ok(result.expiry.getTime() < Date.now())
  })

  it('set with Expires header then get returns object with header-derived expiry', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/2`
    const noteObject = { id, type: 'Note', content: 'Expires header test' }
    const expiresDate = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now
    const headers = new Headers({ expires: expiresDate.toUTCString() })
    await cache.set(id, TEST_USERNAME, noteObject, headers)

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, noteObject)
    assert.ok(result.expiry instanceof Date)
    assert.ok(Math.abs(result.expiry.getTime() - expiresDate.getTime()) < 1000)
  })

  it('set with no cache headers and type Create uses Activity default expiry (1 day)', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/create/1`
    const createObject = { id, type: 'Create', actor: `${REMOTE_ACTOR_ID}` }
    await cache.set(id, TEST_USERNAME, createObject, new Headers())

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, createObject)
    assert.ok(result.expiry instanceof Date)
    const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000 // 1 day
    assert.ok(Math.abs(result.expiry.getTime() - expectedExpiry) < 1000)
  })

  it('set with no cache headers and type CryptographicKey expires immediately', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/publickey`
    const keyObject = { id, type: 'https://w3id.org/security#CryptographicKey', owner: REMOTE_ACTOR_ID }
    await cache.set(id, TEST_USERNAME, keyObject, new Headers())

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, keyObject)
    assert.ok(result.expiry instanceof Date)
    assert.ok(result.expiry.getTime() < Date.now())
  })

  it('set with no cache headers and type CollectionPage expires immediately', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/followers?page=1`
    const collectionPageObject = { id, type: 'CollectionPage' }
    await cache.set(id, TEST_USERNAME, collectionPageObject, new Headers())

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, collectionPageObject)
    assert.ok(result.expiry instanceof Date)
    assert.ok(result.expiry.getTime() < Date.now())
  })

  it('set with no cache headers and type Note uses content default expiry (5 minutes)', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/3`
    const noteObject = { id, type: 'Note', content: 'Default expiry test' }
    await cache.set(id, TEST_USERNAME, noteObject, new Headers())

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, noteObject)
    assert.ok(result.expiry instanceof Date)
    const expectedExpiry = Date.now() + 5 * 60 * 1000 // 5 minutes
    assert.ok(Math.abs(result.expiry.getTime() - expectedExpiry) < 1000)
  })

  it('set() with Cache-Control: no-store skips storage and get() returns null', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/5`
    const noteObject = { id, type: 'Note', content: 'no-store test' }
    const headers = new Headers({ 'cache-control': 'no-store' })
    await cache.set(id, TEST_USERNAME, noteObject, headers)

    const result = await cache.get(id, TEST_USERNAME)
    assert.equal(result, null)
  })

  it('set() with Cache-Control: no-cache stores object but expiry is already past', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/6`
    const noteObject = { id, type: 'Note', content: 'no-cache test' }
    const headers = new Headers({ 'cache-control': 'no-cache' })
    await cache.set(id, TEST_USERNAME, noteObject, headers)

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, noteObject)
    assert.ok(result.expiry.getTime() < Date.now())
  })

  it('set() with etag and last-modified headers stores and get() returns them', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/7`
    const noteObject = { id, type: 'Note', content: 'etag test' }
    const lastModified = new Date(Date.now() - 60 * 1000).toUTCString()
    const headers = new Headers({
      'cache-control': 'max-age=3600',
      etag: '"abc123"',
      'last-modified': lastModified
    })
    await cache.set(id, TEST_USERNAME, noteObject, headers)

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.equal(result.etag, '"abc123"')
    assert.ok(result.lastModified instanceof Date)
    assert.ok(Math.abs(result.lastModified.getTime() - new Date(lastModified).getTime()) < 1000)
  })

  it('set() with no etag or last-modified headers returns null for both on get()', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/8`
    const noteObject = { id, type: 'Note', content: 'no etag test' }
    await cache.set(id, TEST_USERNAME, noteObject, new Headers({ 'cache-control': 'max-age=3600' }))

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.equal(result.etag, null)
    assert.equal(result.lastModified, null)
  })

  it('same id with different usernames are cached independently', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/9`
    const OTHER_USERNAME = 'remoteobjectcachetestbot2'
    const firstObject = { id, type: 'Note', content: 'first user version' }
    const secondObject = { id, type: 'Note', content: 'second user version' }
    await cache.set(id, TEST_USERNAME, firstObject, new Headers({ 'cache-control': 'max-age=3600' }))
    await cache.set(id, OTHER_USERNAME, secondObject, new Headers({ 'cache-control': 'max-age=3600' }))

    const firstResult = await cache.get(id, TEST_USERNAME)
    const secondResult = await cache.get(id, OTHER_USERNAME)
    assert.deepEqual(firstResult.object, firstObject)
    assert.deepEqual(secondResult.object, secondObject)
  })

  it('second set() overwrites first set() and get() returns updated values', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/4`
    const first = { id, type: 'Note', content: 'First version' }
    const second = { id, type: 'Note', content: 'Second version' }
    const firstHeaders = new Headers({ 'cache-control': 'max-age=60' })
    const secondHeaders = new Headers({ 'cache-control': 'max-age=3600' })
    await cache.set(id, TEST_USERNAME, first, firstHeaders)
    await cache.set(id, TEST_USERNAME, second, secondHeaders)

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, second)
    const expectedExpiry = Date.now() + 3600 * 1000
    assert.ok(Math.abs(result.expiry.getTime() - expectedExpiry) < 1000)
  })

  it('set() with no headers argument stores the object using type-based default expiry', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/10`
    const noteObject = { id, type: 'Note', content: 'null headers test' }
    await cache.set(id, TEST_USERNAME, noteObject)

    const result = await cache.get(id, TEST_USERNAME)
    assert.ok(result)
    assert.deepEqual(result.object, noteObject)
    assert.ok(result.expiry instanceof Date)
    // No headers means no etag/last-modified to record.
    assert.equal(result.etag, null)
    assert.equal(result.lastModified, null)
    // Note → 5-minute content default expiry from #getExpiryFromObject.
    const expectedExpiry = Date.now() + 5 * 60 * 1000
    assert.ok(Math.abs(result.expiry.getTime() - expectedExpiry) < 1000)
  })

  it('clear(id) removes entries for all usernames at that id', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/11`
    const OTHER_USERNAME = 'remoteobjectcachetestbot3'
    const objectForFirst = { id, type: 'Note', content: 'first user' }
    const objectForOther = { id, type: 'Note', content: 'other user' }
    await cache.set(id, TEST_USERNAME, objectForFirst)
    await cache.set(id, OTHER_USERNAME, objectForOther)

    // Sanity: both rows exist before clear.
    assert.ok(await cache.get(id, TEST_USERNAME))
    assert.ok(await cache.get(id, OTHER_USERNAME))

    await cache.clear(id)

    assert.equal(await cache.get(id, TEST_USERNAME), null)
    assert.equal(await cache.get(id, OTHER_USERNAME), null)
  })

  it('clear(id) does not affect entries with different ids', async () => {
    const keepId = `https://${REMOTE_HOST}/user/testuser/note/12`
    const removeId = `https://${REMOTE_HOST}/user/testuser/note/13`
    await cache.set(keepId, TEST_USERNAME, { id: keepId, type: 'Note', content: 'keep' })
    await cache.set(removeId, TEST_USERNAME, { id: removeId, type: 'Note', content: 'remove' })

    await cache.clear(removeId)

    const kept = await cache.get(keepId, TEST_USERNAME)
    assert.ok(kept)
    assert.equal(kept.object.content, 'keep')
    assert.equal(await cache.get(removeId, TEST_USERNAME), null)
  })

  it('clear(id) on a non-existent id is a no-op', async () => {
    const id = `https://${REMOTE_HOST}/user/testuser/note/never-cached`
    await assert.doesNotReject(cache.clear(id))
  })

})
