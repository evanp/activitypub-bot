import { describe, before, after, it, beforeEach } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import {
  nockSetup,
  getRequestHeaders,
  resetRequestHeaders,
  addToCollection,
  nockFormat,
  getBody
} from '@evanp/activitypub-nock'

import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import as2 from '../lib/activitystreams.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

function escapeRegex (str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const EPSILON = 100

describe('ActivityPubClient', async () => {
  const LOCAL_HOST = 'local.activitypubclient.test'
  const REMOTE_HOST = 'social.activitypubclient.test'
  const LIMITED_HOST = 'limited.activitypubclient.test'
  const LOCAL_ORIGIN = `https://${LOCAL_HOST}`
  const LOCAL_SIGNING_USER = 'activitypubclienttestfoobot'
  const REMOTE_PROFILE_USER = 'activitypubclientevan'
  const REMOTE_COLLECTION_USER = 'activitypubclientremote1'
  const REMOTE_RELAY_USER = 'activitypubclientrelay'
  const LIMITED_USER_1 = 'activitypubclienttestlimit1'
  const LIMITED_USER_2 = 'activitypubclienttestlimit2'
  const REMOTE_COLLECTION = 1
  const REMOTE_ORDERED_COLLECTION = 2
  const REMOTE_PAGED_COLLECTION = 3
  const REMOTE_PAGED_ORDERED_COLLECTION = 4
  const MAX_ITEMS = 10
  const TEST_USERNAMES = [LOCAL_SIGNING_USER]
  const REMOTE_NOTE_1 = `https://${REMOTE_HOST}/user/${REMOTE_PROFILE_USER}/note/1`
  const REMOTE_PUBLIC_KEY = `https://${REMOTE_HOST}/user/${REMOTE_PROFILE_USER}/publickey`
  const REMOTE_INBOX = `https://${REMOTE_HOST}/user/${REMOTE_PROFILE_USER}/inbox`
  const SIGNATURE_GET_WITH_USER_RE = new RegExp(
    `^keyId="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(LOCAL_SIGNING_USER)}/publickey",headers="\\(request-target\\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$`
  )
  const SIGNATURE_GET_WITHOUT_USER_RE = new RegExp(
    `^keyId="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(LOCAL_HOST)}/publickey",headers="\\(request-target\\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$`
  )
  const SIGNATURE_POST_RE = new RegExp(
    `^keyId="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(LOCAL_SIGNING_USER)}/publickey",headers="\\(request-target\\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$`
  )

  function nockFormatPlus (params) {
    return nockFormat(params.domain ? params : { domain: REMOTE_HOST, ...params })
  }

  let connection = null
  let keyStorage = null
  let formatter = null
  let client = null
  let signer = null
  let digester = null
  let logger = null
  let limiter = null

  before(async () => {
    logger = new Logger({
      level: 'silent'
    })
    digester = new Digester(logger)
    signer = new HTTPSignature(logger)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, LIMITED_HOST]
    })
    keyStorage = new KeyStorage(connection, logger)
    formatter = new UrlFormatter(LOCAL_ORIGIN)
    limiter = new RateLimiter(connection, logger)

    nockSetup(REMOTE_HOST, logger)
    nockSetup(LIMITED_HOST, { rateLimit: true })
    for (let i = 0; i < MAX_ITEMS; i++) {
      const id = nockFormatPlus({ domain: REMOTE_HOST, username: REMOTE_COLLECTION_USER, type: 'note', num: i })
      addToCollection(REMOTE_COLLECTION_USER, REMOTE_COLLECTION, id, REMOTE_HOST)
    }
    for (let i = MAX_ITEMS; i < 2 * MAX_ITEMS; i++) {
      const id = nockFormatPlus({ domain: REMOTE_HOST, username: REMOTE_COLLECTION_USER, type: 'note', num: i })
      addToCollection(REMOTE_COLLECTION_USER, REMOTE_ORDERED_COLLECTION, id, REMOTE_HOST)
    }
    for (let i = 2 * MAX_ITEMS; i < 7 * MAX_ITEMS; i++) {
      const id = nockFormatPlus({ domain: REMOTE_HOST, username: REMOTE_COLLECTION_USER, type: 'note', num: i })
      addToCollection(REMOTE_COLLECTION_USER, REMOTE_PAGED_COLLECTION, id, REMOTE_HOST)
    }
    for (let i = 7 * MAX_ITEMS; i < 12 * MAX_ITEMS; i++) {
      const id = nockFormatPlus({ domain: REMOTE_HOST, username: REMOTE_COLLECTION_USER, type: 'note', num: i })
      addToCollection(REMOTE_COLLECTION_USER, REMOTE_PAGED_ORDERED_COLLECTION, id, REMOTE_HOST)
    }
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, LIMITED_HOST]
    })
    await connection.close()
    keyStorage = null
    connection = null
    formatter = null
    client = null
    logger = null
    digester = null
    signer = null
  })

  beforeEach(async () => {
    resetRequestHeaders()
  })

  it('can initialize', () => {
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, remoteObjectCache)
    assert.ok(client)
  })

  it('can get a remote object with a username', async () => {
    const id = REMOTE_NOTE_1
    const obj = await client.get(id, LOCAL_SIGNING_USER)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    const h = getRequestHeaders(id)
    assert.ok(h.signature)
    assert.match(h.signature, SIGNATURE_GET_WITH_USER_RE)
    assert.equal(typeof h.digest, 'undefined')
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
    })
  })

  it('can get a remote object without a username', async () => {
    const id = REMOTE_NOTE_1
    const obj = await client.get(id)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    const h = getRequestHeaders(id)
    assert.ok(h.signature)
    assert.match(h.signature, SIGNATURE_GET_WITHOUT_USER_RE)
    assert.equal(typeof h.digest, 'undefined')
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
    })
  })

  it('can get a remote key without a signature', async () => {
    const id = REMOTE_PUBLIC_KEY
    const obj = await client.getKey(id)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    const h = getRequestHeaders(id)
    assert.equal(h.signature, undefined)
    assert.equal(typeof h.digest, 'undefined')
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
    })
  })

  it('can deliver an activity', async () => {
    const obj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(`https://${REMOTE_HOST}/user/${REMOTE_PROFILE_USER}`)
      .to(`https://${REMOTE_HOST}/user/${REMOTE_PROFILE_USER}`)
      .publishedNow()
      .get()
    const inbox = REMOTE_INBOX
    await client.post(inbox, obj, LOCAL_SIGNING_USER)
    const h = getRequestHeaders(inbox)
    assert.ok(h.signature)
    assert.ok(h.digest)
    assert.match(h.signature, SIGNATURE_POST_RE)
    assert.match(h.digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
    })
  })

  it('throws an error on a non-2xx response', async () => {
    const inbox = REMOTE_INBOX
    try {
      await client.get(inbox, LOCAL_SIGNING_USER)
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error)
      assert.equal(error.status, 403)
    }
  })

  it('can iterate over a Collection', async () => {
    const collectionUri = nockFormatPlus({
      domain: REMOTE_HOST,
      username: REMOTE_COLLECTION_USER,
      type: 'Collection',
      num: REMOTE_COLLECTION
    })
    let counter = 0
    for await (const item of client.items(collectionUri)) {
      assert.ok(item)
      counter = counter + 1
    }
    assert.strictEqual(counter, MAX_ITEMS)
  })

  it('can iterate over an OrderedCollection', async () => {
    const collectionUri = nockFormatPlus({
      domain: REMOTE_HOST,
      username: REMOTE_COLLECTION_USER,
      type: 'OrderedCollection',
      num: REMOTE_ORDERED_COLLECTION
    })
    let counter = 0
    for await (const item of client.items(collectionUri)) {
      assert.ok(item)
      counter = counter + 1
    }
    assert.strictEqual(counter, MAX_ITEMS)
  })

  it('can iterate over a paged Collection', async () => {
    const collectionUri = nockFormatPlus({
      domain: REMOTE_HOST,
      username: REMOTE_COLLECTION_USER,
      type: 'PagedCollection', // Fake type
      num: REMOTE_PAGED_COLLECTION
    })
    let counter = 0
    for await (const item of client.items(collectionUri)) {
      assert.ok(item)
      counter = counter + 1
    }
    assert.strictEqual(counter, 5 * MAX_ITEMS)
  })

  it('can iterate over a paged OrderedCollection', async () => {
    const collectionUri = nockFormatPlus({
      domain: REMOTE_HOST,
      username: REMOTE_COLLECTION_USER,
      type: 'PagedOrderedCollection', // Fake type
      num: REMOTE_PAGED_ORDERED_COLLECTION
    })
    let counter = 0
    for await (const item of client.items(collectionUri)) {
      assert.ok(item)
      counter = counter + 1
    }
    assert.strictEqual(counter, 5 * MAX_ITEMS)
  })

  it('sends a relay subscription with full Public URL', async () => {
    const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
    const obj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(PUBLIC)
      .to(`https://${REMOTE_HOST}/user/${REMOTE_RELAY_USER}`)
      .publishedNow()
      .get()
    const inbox = REMOTE_INBOX
    await client.post(inbox, obj, LOCAL_SIGNING_USER)
    const body = JSON.parse(getBody(inbox))
    assert.strictEqual(typeof body.object, 'string')
    assert.strictEqual(body.object, PUBLIC)
  })

  it('sends a relay unsubscription with full Public URL', async () => {
    const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
    const obj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(PUBLIC)
      .to(`https://${REMOTE_HOST}/user/${REMOTE_RELAY_USER}`)
      .publishedNow()
      .get()
    const undo = as2.undo()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(obj)
      .to(`https://${REMOTE_HOST}/user/${REMOTE_RELAY_USER}`)
      .publishedNow()
      .get()
    const inbox = REMOTE_INBOX
    await client.post(inbox, undo, LOCAL_SIGNING_USER)
    const body = JSON.parse(getBody(inbox))
    assert.strictEqual(typeof body.object?.object, 'string')
    assert.strictEqual(body.object?.object, PUBLIC)
  })

  it('does not wait for the first request to a limited server', async () => {
    const id = nockFormat({
      username: LIMITED_USER_1,
      type: 'note',
      num: 1,
      domain: LIMITED_HOST
    })
    const startTime = new Date()
    await client.get(id)
    const endTime = new Date()
    assert.ok(endTime - startTime < EPSILON, `${endTime - startTime} > ${EPSILON}`)
  })

  it('waits for the next requests to a limited server', async () => {
    const startTime = new Date()
    for (let i = 0; i < 10; i++) {
      const id = nockFormat({
        username: LIMITED_USER_2,
        type: 'note',
        num: i,
        domain: LIMITED_HOST
      })
      await client.get(id)
    }
    const endTime = new Date()
    assert.ok(endTime - startTime > EPSILON, `${endTime - startTime} > ${EPSILON}`)
  })

  describe('with a cache', async () => {
    const CACHED_NOTE = `https://${REMOTE_HOST}/user/${REMOTE_PROFILE_USER}/note/100`
    let cache = null
    let cachedClient = null

    before(async () => {
      cache = new RemoteObjectCache(connection, logger)
      cachedClient = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, cache)
    })

    after(async () => {
      cache = null
      cachedClient = null
    })

    it('no cache record: hits the remote server', async () => {
      await cachedClient.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.ok(h)
    })

    it('unexpired cache record: does not hit the server', async () => {
      const cachedObject = { id: CACHED_NOTE, type: 'Note', content: 'cached' }
      await cache.set(CACHED_NOTE, LOCAL_SIGNING_USER, cachedObject, new Headers({ 'cache-control': 'max-age=3600' }))
      const result = await cachedClient.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      assert.ok(result)
      assert.equal(result.id, CACHED_NOTE)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.equal(h, undefined)
    })

    it('expired cache record: hits server with If-None-Match and If-Modified-Since', async () => {
      const cachedObject = { id: CACHED_NOTE, type: 'Note', content: 'cached' }
      const etag = '"abc123"'
      const lastModified = new Date(Date.now() - 24 * 60 * 60 * 1000).toUTCString()
      await cache.set(CACHED_NOTE, LOCAL_SIGNING_USER, cachedObject, new Headers({
        'cache-control': 'no-cache',
        etag,
        'last-modified': lastModified
      }))
      await cachedClient.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.ok(h)
      assert.equal(h['if-none-match'], etag)
      assert.equal(h['if-modified-since'], lastModified)
    })

    it('expired cache record with no etag or last-modified: does not send conditional headers', async () => {
      const cachedObject = { id: CACHED_NOTE, type: 'Note', content: 'cached' }
      await cache.set(CACHED_NOTE, LOCAL_SIGNING_USER, cachedObject, new Headers({
        'cache-control': 'no-cache'
      }))
      await cachedClient.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.ok(h)
      assert.equal(h['if-none-match'], undefined)
      assert.equal(h['if-modified-since'], undefined)
    })
  })
})
