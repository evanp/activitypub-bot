import { describe, before, after, it, beforeEach } from 'node:test'
import assert from 'node:assert'

import nock from 'nock'
import Logger from 'pino'
import {
  nockSetup,
  getRequestHeaders,
  resetRequestHeaders,
  addToCollection,
  nockFormat,
  getBody,
  makeObject
} from '@evanp/activitypub-nock'

import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import as2 from '../lib/activitystreams.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

function escapeRegex (str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const EPSILON = 100

describe('ActivityPubClient', async () => {
  const LOCAL_HOST = 'local.activitypubclient.test'
  const REMOTE_HOST = 'social.activitypubclient.test'
  const LIMITED_HOST = 'limited.activitypubclient.test'
  const RFC9421_HOST = 'rfc9421.activitypubclient.test'
  const DOUBLE_KNOCK_HOST = 'doubleknock.activitypubclient.test'
  const CACHED_DRAFT_HOST = 'cacheddraft.activitypubclient.test'
  const EXPIRED_DRAFT_HOST = 'expireddraft.activitypubclient.test'
  const NO_FALLBACK_HOST = 'nofallback.activitypubclient.test'
  const RFC9421_POST_HOST = 'rfc9421-post.activitypubclient.test'
  const DOUBLE_KNOCK_POST_HOST = 'doubleknock-post.activitypubclient.test'
  const CACHED_DRAFT_POST_HOST = 'cacheddraft-post.activitypubclient.test'
  const EXPIRED_DRAFT_POST_HOST = 'expireddraft-post.activitypubclient.test'
  const NO_FALLBACK_POST_HOST = 'nofallback-post.activitypubclient.test'
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
  const DRAFT_SIGNATURE_GET_WITH_USER_RE = new RegExp(
    `^keyId="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(LOCAL_SIGNING_USER)}/publickey",headers="\\(request-target\\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$`
  )
  const DRAFT_SIGNATURE_GET_WITHOUT_USER_RE = new RegExp(
    `^keyId="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(LOCAL_HOST)}/publickey",headers="\\(request-target\\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$`
  )
  const SIGNATURE_POST_RE = new RegExp(
    `^keyId="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(LOCAL_SIGNING_USER)}/publickey",headers="\\(request-target\\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$`
  )
  const MESSAGE_SIGNATURE_RE = /^sig1=:[0-9A-Za-z+/=]+:$/

  function nockFormatPlus (params) {
    return nockFormat(params.domain ? params : { domain: REMOTE_HOST, ...params })
  }

  function normalizeHeaders (headers) {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
    )
  }

  function assertRfc9421GetHeaders (headers, username = LOCAL_SIGNING_USER) {
    assert.ok(headers)
    assert.ok(headers.signature)
    assert.match(headers.signature, MESSAGE_SIGNATURE_RE)
    assert.equal(typeof headers['signature-input'], 'string')
    assert.match(
      headers['signature-input'],
      new RegExp(
        `^sig1=\\("@method" "@target-uri" "accept" "date" "user-agent"\\);keyid="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(username)}/publickey";alg="rsa-v1_5-sha256";created=\\d+$`
      )
    )
  }

  function assertDraftCavageGetHeaders (headers, username = LOCAL_SIGNING_USER) {
    assert.ok(headers)
    assert.ok(headers.signature)
    assert.match(
      headers.signature,
      username === LOCAL_SIGNING_USER
        ? DRAFT_SIGNATURE_GET_WITH_USER_RE
        : DRAFT_SIGNATURE_GET_WITHOUT_USER_RE
    )
    assert.equal(headers['signature-input'], undefined)
  }

  function assertRfc9421PostHeaders (headers, username = LOCAL_SIGNING_USER) {
    assert.ok(headers)
    assert.ok(headers.signature)
    assert.match(headers.signature, MESSAGE_SIGNATURE_RE)
    assert.equal(typeof headers['signature-input'], 'string')
    assert.match(
      headers['signature-input'],
      new RegExp(
        `^sig1=\\("@method" "@target-uri" "date" "user-agent" "content-type" "content-digest"\\);keyid="https://${escapeRegex(LOCAL_HOST)}/user/${escapeRegex(username)}/publickey";alg="rsa-v1_5-sha256";created=\\d+$`
      )
    )
  }

  function assertDraftCavagePostHeaders (headers) {
    assert.ok(headers)
    assert.ok(headers.signature)
    assert.match(headers.signature, SIGNATURE_POST_RE)
    assert.equal(headers['signature-input'], undefined)
  }

  let connection = null
  let keyStorage = null
  let formatter = null
  let client = null
  let signer = null
  let messageSigner = null
  let digester = null
  let logger = null
  let limiter = null
  let policyStorage = null
  let remoteObjectCache = null

  before(async () => {
    logger = new Logger({
      level: 'silent'
    })
    digester = new Digester(logger)
    signer = new HTTPSignature(logger)
    messageSigner = new HTTPMessageSignature(logger)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [
        REMOTE_HOST,
        LIMITED_HOST,
        RFC9421_HOST,
        DOUBLE_KNOCK_HOST,
        CACHED_DRAFT_HOST,
        EXPIRED_DRAFT_HOST,
        NO_FALLBACK_HOST,
        RFC9421_POST_HOST,
        DOUBLE_KNOCK_POST_HOST,
        CACHED_DRAFT_POST_HOST,
        EXPIRED_DRAFT_POST_HOST,
        NO_FALLBACK_POST_HOST
      ]
    })
    keyStorage = new KeyStorage(connection, logger)
    formatter = new UrlFormatter(LOCAL_ORIGIN)
    limiter = new RateLimiter(connection, logger)
    policyStorage = new SignaturePolicyStorage(connection, logger)
    remoteObjectCache = new RemoteObjectCache(connection, logger)
    client = new ActivityPubClient(
      keyStorage,
      formatter,
      signer,
      digester,
      logger,
      limiter,
      remoteObjectCache,
      messageSigner,
      policyStorage
    )

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
      remoteDomains: [
        REMOTE_HOST,
        LIMITED_HOST,
        RFC9421_HOST,
        DOUBLE_KNOCK_HOST,
        CACHED_DRAFT_HOST,
        EXPIRED_DRAFT_HOST,
        NO_FALLBACK_HOST,
        RFC9421_POST_HOST,
        DOUBLE_KNOCK_POST_HOST,
        CACHED_DRAFT_POST_HOST,
        EXPIRED_DRAFT_POST_HOST,
        NO_FALLBACK_POST_HOST
      ]
    })
    await connection.close()
  })

  beforeEach(async () => {
    resetRequestHeaders()
  })

  it('can initialize', () => {
    assert.ok(client)
  })

  it('can get a remote object with a username', async () => {
    const id = REMOTE_NOTE_1
    const obj = await client.get(id, LOCAL_SIGNING_USER)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    const h = getRequestHeaders(id)
    assertRfc9421GetHeaders(h, LOCAL_SIGNING_USER)
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
    assertRfc9421GetHeaders(h, LOCAL_HOST)
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
    assertRfc9421PostHeaders(h, LOCAL_SIGNING_USER)
    assert.equal(typeof h.digest, 'undefined')
    assert.ok(h['content-digest'])
    assert.match(h['content-digest'], /^sha-256=:[0-9a-zA-Z+/=]*:$/)
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

  it('sends draft-cavage-12 if RFC 9421 fails on POST', async () => {
    const inbox = nockFormat({
      username: REMOTE_PROFILE_USER,
      collection: 'inbox',
      domain: DOUBLE_KNOCK_POST_HOST
    })
    const obj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(`https://${DOUBLE_KNOCK_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .to(`https://${DOUBLE_KNOCK_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .publishedNow()
      .get()
    const requests = []
    let requestNumber = 0

    nock(`https://${DOUBLE_KNOCK_POST_HOST}`)
      .post(`/user/${REMOTE_PROFILE_USER}/inbox`)
      .twice()
      .reply(function () {
        requestNumber += 1
        requests.push(normalizeHeaders(this.req.headers))
        return (requestNumber === 1)
          ? [403, 'forbidden']
          : [202, 'accepted']
      })

    await client.post(inbox, obj, LOCAL_SIGNING_USER)

    assert.strictEqual(requests.length, 2)
    assertRfc9421PostHeaders(requests[0], LOCAL_SIGNING_USER)
    assertDraftCavagePostHeaders(requests[1])
  })

  it('does not send RFC 9421 after an RFC 9421 failure plus draft-cavage-12 success on POST', async () => {
    const firstInbox = nockFormat({
      username: REMOTE_PROFILE_USER,
      collection: 'inbox',
      domain: CACHED_DRAFT_POST_HOST
    })
    const secondInbox = nockFormat({
      username: REMOTE_RELAY_USER,
      collection: 'inbox',
      domain: CACHED_DRAFT_POST_HOST
    })
    const firstObj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(`https://${CACHED_DRAFT_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .to(`https://${CACHED_DRAFT_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .publishedNow()
      .get()
    const secondObj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(`https://${CACHED_DRAFT_POST_HOST}/user/${REMOTE_RELAY_USER}`)
      .to(`https://${CACHED_DRAFT_POST_HOST}/user/${REMOTE_RELAY_USER}`)
      .publishedNow()
      .get()
    const firstRequests = []
    const secondRequests = []
    let firstRequestNumber = 0

    nock(`https://${CACHED_DRAFT_POST_HOST}`)
      .post(`/user/${REMOTE_PROFILE_USER}/inbox`)
      .twice()
      .reply(function () {
        firstRequestNumber += 1
        firstRequests.push(normalizeHeaders(this.req.headers))
        return (firstRequestNumber === 1)
          ? [403, 'forbidden']
          : [202, 'accepted']
      })
      .post(`/user/${REMOTE_RELAY_USER}/inbox`)
      .reply(function () {
        secondRequests.push(normalizeHeaders(this.req.headers))
        return [202, 'accepted']
      })

    await client.post(firstInbox, firstObj, LOCAL_SIGNING_USER)
    await client.post(secondInbox, secondObj, LOCAL_SIGNING_USER)

    assert.strictEqual(firstRequests.length, 2)
    assertRfc9421PostHeaders(firstRequests[0], LOCAL_SIGNING_USER)
    assertDraftCavagePostHeaders(firstRequests[1])
    assert.strictEqual(secondRequests.length, 1)
    assertDraftCavagePostHeaders(secondRequests[0])
  })

  it('sends RFC 9421 again after a cached draft-cavage-12 policy expires on POST', async () => {
    const firstInbox = nockFormat({
      username: REMOTE_PROFILE_USER,
      collection: 'inbox',
      domain: EXPIRED_DRAFT_POST_HOST
    })
    const secondInbox = nockFormat({
      username: REMOTE_RELAY_USER,
      collection: 'inbox',
      domain: EXPIRED_DRAFT_POST_HOST
    })
    const firstObj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(`https://${EXPIRED_DRAFT_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .to(`https://${EXPIRED_DRAFT_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .publishedNow()
      .get()
    const secondObj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(`https://${EXPIRED_DRAFT_POST_HOST}/user/${REMOTE_RELAY_USER}`)
      .to(`https://${EXPIRED_DRAFT_POST_HOST}/user/${REMOTE_RELAY_USER}`)
      .publishedNow()
      .get()
    const firstRequests = []
    const secondRequests = []
    let firstRequestNumber = 0
    let secondRequestNumber = 0

    nock(`https://${EXPIRED_DRAFT_POST_HOST}`)
      .post(`/user/${REMOTE_PROFILE_USER}/inbox`)
      .twice()
      .reply(function () {
        firstRequestNumber += 1
        firstRequests.push(normalizeHeaders(this.req.headers))
        return (firstRequestNumber === 1)
          ? [403, 'forbidden']
          : [202, 'accepted']
      })
      .post(`/user/${REMOTE_RELAY_USER}/inbox`)
      .twice()
      .reply(function () {
        secondRequestNumber += 1
        secondRequests.push(normalizeHeaders(this.req.headers))
        return (secondRequestNumber === 1)
          ? [403, 'forbidden']
          : [202, 'accepted']
      })

    await client.post(firstInbox, firstObj, LOCAL_SIGNING_USER)
    await connection.query(
      'UPDATE signature_policy SET expiry = ? WHERE origin = ?',
      { replacements: [new Date(Date.now() - 1000), `https://${EXPIRED_DRAFT_POST_HOST}`] }
    )

    await client.post(secondInbox, secondObj, LOCAL_SIGNING_USER)

    assert.strictEqual(firstRequests.length, 2)
    assertRfc9421PostHeaders(firstRequests[0], LOCAL_SIGNING_USER)
    assertDraftCavagePostHeaders(firstRequests[1])
    assert.strictEqual(secondRequests.length, 2)
    assertRfc9421PostHeaders(secondRequests[0], LOCAL_SIGNING_USER)
    assertDraftCavagePostHeaders(secondRequests[1])
  })

  it('does not fall back on non-auth failures on POST', async () => {
    const inbox = nockFormat({
      username: REMOTE_PROFILE_USER,
      collection: 'inbox',
      domain: NO_FALLBACK_POST_HOST
    })
    const obj = as2.follow()
      .actor(`${LOCAL_ORIGIN}/user/${LOCAL_SIGNING_USER}`)
      .object(`https://${NO_FALLBACK_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .to(`https://${NO_FALLBACK_POST_HOST}/user/${REMOTE_PROFILE_USER}`)
      .publishedNow()
      .get()
    const requests = []

    nock(`https://${NO_FALLBACK_POST_HOST}`)
      .post(`/user/${REMOTE_PROFILE_USER}/inbox`)
      .reply(function () {
        requests.push(normalizeHeaders(this.req.headers))
        return [404, 'not found']
      })

    try {
      await client.post(inbox, obj, LOCAL_SIGNING_USER)
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error)
      assert.equal(error.status, 404)
    }

    assert.strictEqual(requests.length, 1)
    assertRfc9421PostHeaders(requests[0], LOCAL_SIGNING_USER)
  })

  it('sends RFC 9421 signature first', async () => {
    const url = nockFormat({
      username: REMOTE_PROFILE_USER,
      type: 'note',
      num: 101,
      domain: RFC9421_HOST
    })
    const note = await makeObject(REMOTE_PROFILE_USER, 'note', 101, RFC9421_HOST)
    const noteText = await note.write({ useOriginalContext: true })
    const requests = []

    nock(`https://${RFC9421_HOST}`)
      .get('/user/activitypubclientevan/note/101')
      .reply(function () {
        requests.push(normalizeHeaders(this.req.headers))
        return [200, noteText, { 'Content-Type': 'application/activity+json' }]
      })

    const obj = await client.get(url, LOCAL_SIGNING_USER)
    assert.ok(obj)

    assert.strictEqual(requests.length, 1)
    assertRfc9421GetHeaders(requests[0], LOCAL_SIGNING_USER)
  })

  it('sends draft-cavage-12 if RFC 9421 fails', async () => {
    const url = nockFormat({
      username: REMOTE_PROFILE_USER,
      type: 'note',
      num: 102,
      domain: DOUBLE_KNOCK_HOST
    })
    const note = await makeObject(REMOTE_PROFILE_USER, 'note', 102, DOUBLE_KNOCK_HOST)
    const noteText = await note.write({ useOriginalContext: true })
    const requests = []
    let requestNumber = 0

    nock(`https://${DOUBLE_KNOCK_HOST}`)
      .get('/user/activitypubclientevan/note/102')
      .twice()
      .reply(function () {
        requestNumber += 1
        requests.push(normalizeHeaders(this.req.headers))
        return (requestNumber === 1)
          ? [403, 'forbidden']
          : [200, noteText, { 'Content-Type': 'application/activity+json' }]
      })

    const obj = await client.get(url, LOCAL_SIGNING_USER)
    assert.ok(obj)
    assert.strictEqual(requests.length, 2)
    assertRfc9421GetHeaders(requests[0], LOCAL_SIGNING_USER)
    assertDraftCavageGetHeaders(requests[1], LOCAL_SIGNING_USER)
  })

  it('does not send RFC 9421 after an RFC 9421 failure plus draft-cavage-12 success', async () => {
    const firstUrl = nockFormat({
      username: REMOTE_PROFILE_USER,
      type: 'note',
      num: 103,
      domain: CACHED_DRAFT_HOST
    })
    const secondUrl = nockFormat({
      username: REMOTE_PROFILE_USER,
      type: 'note',
      num: 104,
      domain: CACHED_DRAFT_HOST
    })
    const firstNote = await makeObject(REMOTE_PROFILE_USER, 'note', 103, CACHED_DRAFT_HOST)
    const secondNote = await makeObject(REMOTE_PROFILE_USER, 'note', 104, CACHED_DRAFT_HOST)
    const firstNoteText = await firstNote.write({ useOriginalContext: true })
    const secondNoteText = await secondNote.write({ useOriginalContext: true })
    const firstRequests = []
    const secondRequests = []
    let firstRequestNumber = 0

    nock(`https://${CACHED_DRAFT_HOST}`)
      .get('/user/activitypubclientevan/note/103')
      .twice()
      .reply(function () {
        firstRequestNumber += 1
        firstRequests.push(normalizeHeaders(this.req.headers))
        return (firstRequestNumber === 1)
          ? [403, 'forbidden']
          : [200, firstNoteText, { 'Content-Type': 'application/activity+json' }]
      })
      .get('/user/activitypubclientevan/note/104')
      .reply(function () {
        secondRequests.push(normalizeHeaders(this.req.headers))
        return [200, secondNoteText, { 'Content-Type': 'application/activity+json' }]
      })

    await client.get(firstUrl, LOCAL_SIGNING_USER)
    await client.get(secondUrl, LOCAL_SIGNING_USER)

    assert.strictEqual(firstRequests.length, 2)
    assertRfc9421GetHeaders(firstRequests[0], LOCAL_SIGNING_USER)
    assertDraftCavageGetHeaders(firstRequests[1], LOCAL_SIGNING_USER)
    assert.strictEqual(secondRequests.length, 1)
    assertDraftCavageGetHeaders(secondRequests[0], LOCAL_SIGNING_USER)
  })

  it('sends RFC 9421 again after a cached draft-cavage-12 policy expires', async () => {
    const firstUrl = nockFormat({
      username: REMOTE_PROFILE_USER,
      type: 'note',
      num: 105,
      domain: EXPIRED_DRAFT_HOST
    })
    const secondUrl = nockFormat({
      username: REMOTE_PROFILE_USER,
      type: 'note',
      num: 106,
      domain: EXPIRED_DRAFT_HOST
    })
    const firstNote = await makeObject(REMOTE_PROFILE_USER, 'note', 105, EXPIRED_DRAFT_HOST)
    const secondNote = await makeObject(REMOTE_PROFILE_USER, 'note', 106, EXPIRED_DRAFT_HOST)
    const firstNoteText = await firstNote.write({ useOriginalContext: true })
    const secondNoteText = await secondNote.write({ useOriginalContext: true })
    const firstRequests = []
    const secondRequests = []
    let firstRequestNumber = 0
    let secondRequestNumber = 0

    nock(`https://${EXPIRED_DRAFT_HOST}`)
      .get('/user/activitypubclientevan/note/105')
      .twice()
      .reply(function () {
        firstRequestNumber += 1
        firstRequests.push(normalizeHeaders(this.req.headers))
        return (firstRequestNumber === 1)
          ? [403, 'forbidden']
          : [200, firstNoteText, { 'Content-Type': 'application/activity+json' }]
      })
      .get('/user/activitypubclientevan/note/106')
      .twice()
      .reply(function () {
        secondRequestNumber += 1
        secondRequests.push(normalizeHeaders(this.req.headers))
        return (secondRequestNumber === 1)
          ? [403, 'forbidden']
          : [200, secondNoteText, { 'Content-Type': 'application/activity+json' }]
      })

    await client.get(firstUrl, LOCAL_SIGNING_USER)
    await connection.query(
      'UPDATE signature_policy SET expiry = ? WHERE origin = ?',
      { replacements: [new Date(Date.now() - 1000), `https://${EXPIRED_DRAFT_HOST}`] }
    )

    await client.get(secondUrl, LOCAL_SIGNING_USER)

    assert.strictEqual(firstRequests.length, 2)
    assertRfc9421GetHeaders(firstRequests[0], LOCAL_SIGNING_USER)
    assertDraftCavageGetHeaders(firstRequests[1], LOCAL_SIGNING_USER)
    assert.strictEqual(secondRequests.length, 2)
    assertRfc9421GetHeaders(secondRequests[0], LOCAL_SIGNING_USER)
    assertDraftCavageGetHeaders(secondRequests[1], LOCAL_SIGNING_USER)
  })

  it('does not fall back on non-auth failures', async () => {
    const url = nockFormat({
      username: REMOTE_PROFILE_USER,
      type: 'note',
      num: 107,
      domain: NO_FALLBACK_HOST
    })
    const requests = []

    nock(`https://${NO_FALLBACK_HOST}`)
      .get('/user/activitypubclientevan/note/107')
      .reply(function () {
        requests.push(normalizeHeaders(this.req.headers))
        return [404, 'not found']
      })

    try {
      await client.get(url, LOCAL_SIGNING_USER)
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error)
      assert.equal(error.status, 404)
    }

    assert.strictEqual(requests.length, 1)
    assertRfc9421GetHeaders(requests[0], LOCAL_SIGNING_USER)
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

    it('no cache record: hits the remote server', async () => {
      await client.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.ok(h)
    })

    it('unexpired cache record: does not hit the server', async () => {
      const cachedObject = { id: CACHED_NOTE, type: 'Note', content: 'cached' }
      await remoteObjectCache.set(CACHED_NOTE, LOCAL_SIGNING_USER, cachedObject, new Headers({ 'cache-control': 'max-age=3600' }))
      const result = await client.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      assert.ok(result)
      assert.equal(result.id, CACHED_NOTE)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.equal(h, undefined)
    })

    it('expired cache record: hits server with If-None-Match and If-Modified-Since', async () => {
      const cachedObject = { id: CACHED_NOTE, type: 'Note', content: 'cached' }
      const etag = '"abc123"'
      const lastModified = new Date(Date.now() - 24 * 60 * 60 * 1000).toUTCString()
      await remoteObjectCache.set(CACHED_NOTE, LOCAL_SIGNING_USER, cachedObject, new Headers({
        'cache-control': 'no-cache',
        etag,
        'last-modified': lastModified
      }))
      await client.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.ok(h)
      assert.equal(h['if-none-match'], etag)
      assert.equal(h['if-modified-since'], lastModified)
    })

    it('expired cache record with no etag or last-modified: does not send conditional headers', async () => {
      const cachedObject = { id: CACHED_NOTE, type: 'Note', content: 'cached' }
      await remoteObjectCache.set(CACHED_NOTE, LOCAL_SIGNING_USER, cachedObject, new Headers({
        'cache-control': 'no-cache'
      }))
      await client.get(CACHED_NOTE, LOCAL_SIGNING_USER)
      const h = getRequestHeaders(CACHED_NOTE)
      assert.ok(h)
      assert.equal(h['if-none-match'], undefined)
      assert.equal(h['if-modified-since'], undefined)
    })
  })
})
