import { corsTests } from './utils/cors.js'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import request from 'supertest'
import { nanoid as makeNanoid } from 'nanoid'
import { nockSetup, nockFormat, nockSignature, makeActor } from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'
import OKBot from '../lib/bots/ok.js'
import DoNothingBot from '../lib/bots/donothing.js'
import as2 from '../lib/activitystreams.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASIC_BLOCKLIST = resolve(__dirname, 'fixtures', 'blocklist-basic.csv')
const BLOCKED_HOST = 'blocked-one.test'

const MAX_PAGE_SIZE = 256

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const uppercase = (string) => string.charAt(0).toUpperCase() + string.slice(1)

describe('object collection routes', async () => {
  const LOCAL_HOST = 'local.routes-object.test'
  const REMOTE_HOST = 'remote.routes-object.test'
  const BOT_USERNAME = 'routesobjecttestbot'
  const REMOTE_FOLLOWER_USERNAME = 'routesobjecttestfollower'
  const REMOTE_REPLIER_USERNAME = 'routesobjecttestreplier'
  const REMOTE_LIKER_USERNAME = 'routesobjecttestliker'
  const REMOTE_SHARER_USERNAME = 'routesobjecttestsharer'
  const databaseUrl = getTestDatabaseUrl()
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const remote = REMOTE_HOST
  const username = BOT_USERNAME
  const TEST_USERNAMES = [BOT_USERNAME]
  const testBots = {
    [BOT_USERNAME]: new OKBot(BOT_USERNAME)
  }
  const type = 'object'
  const nanoid = 'hUQC9HWian7dzOxZJlJBA'
  let app = null

  let obj = null
  let reply = null
  let like = null
  let share = null
  let privateObj = null
  const privateNanoid = 'Ic3Sa_0xOQKvlPsWU16as'
  let blockedAnnounce = null
  const blockedNanoid = 'Bl0ckedAnn0unceTest12'
  let subObj = null
  const subNanoid = 'SubObjF0rB10ckTest123'
  let subNormalReply = null
  let subBlockedReply = null
  let subNormalLike = null
  let subBlockedLike = null
  let subNormalShare = null
  let subBlockedShare = null

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent', redisUrl: getTestRedisUrl(), domainBlockFileName: BASIC_BLOCKLIST, allowPrivateNetworkRequests: true
    })
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    const { formatter, objectStorage, actorStorage } = app.locals
    nockSetup(remote)
    obj = await as2.import({
      id: formatter.format({ username, type, nanoid }),
      type: uppercase(type),
      attributedTo: formatter.format({ username }),
      summaryMap: {
        en: 'Test object for the object collection routes'
      },
      replies: formatter.format({ username, type, nanoid, collection: 'replies' }),
      likes: formatter.format({ username, type, nanoid, collection: 'likes' }),
      shares: formatter.format({ username, type, nanoid, collection: 'shares' }),
      to: ['as:Public']
    })
    await objectStorage.create(obj)
    await objectStorage.addToCollection(obj.id, 'thread', obj)
    reply = await as2.import({
      id: nockFormat({
        domain: remote,
        username: REMOTE_REPLIER_USERNAME,
        type: 'note',
        num: 1
      }),
      type: 'Note',
      attributedTo: nockFormat({
        domain: remote,
        username: REMOTE_REPLIER_USERNAME
      }),
      content: 'This is a reply to the test object',
      inReplyTo: obj.id,
      to: [formatter.format({ username }), 'as:Public']
    })
    await objectStorage.addToCollection(obj.id, 'replies', reply)
    await objectStorage.addToCollection(obj.id, 'thread', reply)
    like = await as2.import({
      id: nockFormat({
        domain: remote,
        username: REMOTE_LIKER_USERNAME,
        type: 'like',
        num: 1,
        obj: obj.id
      }),
      type: 'Like',
      attributedTo: nockFormat({
        domain: remote,
        username: REMOTE_LIKER_USERNAME
      }),
      object: obj.id,
      to: [formatter.format({ username }), 'as:Public']
    })
    await objectStorage.addToCollection(obj.id, 'likes', like)
    share = await as2.import({
      id: nockFormat({
        domain: remote,
        username: REMOTE_SHARER_USERNAME,
        type: 'announce',
        num: 1,
        obj: obj.id
      }),
      type: 'Announce',
      attributedTo: nockFormat({
        domain: remote,
        username: REMOTE_SHARER_USERNAME
      }),
      object: obj.id,
      to: [formatter.format({ username }), 'as:Public']
    })
    await objectStorage.addToCollection(obj.id, 'shares', share)
    privateObj = await as2.import({
      id: formatter.format({ username, type, nanoid: privateNanoid }),
      type: uppercase(type),
      attributedTo: formatter.format({ username }),
      summaryMap: {
        en: 'Test object for the object collection routes'
      },
      replies: formatter.format({ username, type, nanoid, collection: 'replies' }),
      likes: formatter.format({ username, type, nanoid, collection: 'likes' }),
      shares: formatter.format({ username, type, nanoid, collection: 'shares' }),
      to: formatter.format({ username, collection: 'followers' })
    })
    await objectStorage.create(privateObj)
    blockedAnnounce = await as2.import({
      id: formatter.format({ username, type, nanoid: blockedNanoid }),
      type: 'Announce',
      attributedTo: formatter.format({ username }),
      object: `https://${BLOCKED_HOST}/notes/1`,
      to: ['as:Public']
    })
    await objectStorage.create(blockedAnnounce)
    subObj = await as2.import({
      id: formatter.format({ username, type, nanoid: subNanoid }),
      type: uppercase(type),
      attributedTo: formatter.format({ username }),
      replies: formatter.format({ username, type, nanoid: subNanoid, collection: 'replies' }),
      likes: formatter.format({ username, type, nanoid: subNanoid, collection: 'likes' }),
      shares: formatter.format({ username, type, nanoid: subNanoid, collection: 'shares' }),
      to: ['as:Public']
    })
    await objectStorage.create(subObj)
    await objectStorage.addToCollection(subObj.id, 'thread', subObj)
    subNormalReply = await as2.import({
      id: nockFormat({ domain: remote, username: 'subnormalreplier', type: 'note', num: 1 }),
      type: 'Note',
      attributedTo: nockFormat({ domain: remote, username: 'subnormalreplier' }),
      content: 'A normal reply',
      inReplyTo: subObj.id,
      to: ['as:Public']
    })
    subBlockedReply = await as2.import({
      id: `https://${BLOCKED_HOST}/users/breplier/note/1`,
      type: 'Note',
      attributedTo: `https://${BLOCKED_HOST}/users/breplier`,
      content: 'A blocked-domain reply',
      inReplyTo: subObj.id,
      to: ['as:Public']
    })
    for (const r of [subNormalReply, subBlockedReply]) {
      await objectStorage.addToCollection(subObj.id, 'replies', r)
      await objectStorage.addToCollection(subObj.id, 'thread', r)
    }
    subNormalLike = await as2.import({
      id: nockFormat({ domain: remote, username: 'subnormalliker', type: 'like', num: 1, obj: subObj.id }),
      type: 'Like',
      attributedTo: nockFormat({ domain: remote, username: 'subnormalliker' }),
      object: subObj.id,
      to: ['as:Public']
    })
    subBlockedLike = await as2.import({
      id: `https://${BLOCKED_HOST}/users/bliker/like/1`,
      type: 'Like',
      attributedTo: `https://${BLOCKED_HOST}/users/bliker`,
      object: subObj.id,
      to: ['as:Public']
    })
    for (const l of [subNormalLike, subBlockedLike]) {
      await objectStorage.addToCollection(subObj.id, 'likes', l)
    }
    subNormalShare = await as2.import({
      id: nockFormat({ domain: remote, username: 'subnormalsharer', type: 'announce', num: 1, obj: subObj.id }),
      type: 'Announce',
      attributedTo: nockFormat({ domain: remote, username: 'subnormalsharer' }),
      object: subObj.id,
      to: ['as:Public']
    })
    subBlockedShare = await as2.import({
      id: `https://${BLOCKED_HOST}/users/bsharer/announce/1`,
      type: 'Announce',
      attributedTo: `https://${BLOCKED_HOST}/users/bsharer`,
      object: subObj.id,
      to: ['as:Public']
    })
    for (const s of [subNormalShare, subBlockedShare]) {
      await objectStorage.addToCollection(subObj.id, 'shares', s)
    }
    const follower = await makeActor(REMOTE_FOLLOWER_USERNAME, remote)
    await actorStorage.addToCollection(
      username,
      'followers',
      follower
    )
    assert.ok(
      await actorStorage.isInCollection(username, 'followers', follower)
    )
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      domainBlockFiles: [BASIC_BLOCKLIST],
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await app.cleanup()
  })

  corsTests(() => app, () => [
    { path: `/user/${username}/${type}/${nanoid}` },
    ...['replies', 'likes', 'shares', 'thread'].flatMap(collection => [
      { path: `/user/${username}/${type}/${nanoid}/${collection}` },
      { path: `/user/${username}/${type}/${nanoid}/${collection}/1` }
    ]),
    { path: () => `/user/${username}/${type}/${privateNanoid}`, status: 403 }
  ])

  describe('GET /user/{username}/{type}/{nanoid}', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'Object')
    })
    it('should return an object with the right summary', async () => {
      assert.strictEqual(typeof response.body.summaryMap, 'object')
      assert.strictEqual(response.body.summaryMap.en, 'Test object for the object collection routes')
    })
    it('should return an object with the right replies', async () => {
      assert.strictEqual(typeof response.body.replies, 'string')
      assert.strictEqual(response.body.replies, `${origin}/user/${username}/${type}/${nanoid}/replies`)
    })
    it('should return an object with the right likes', async () => {
      assert.strictEqual(typeof response.body.likes, 'string')
      assert.strictEqual(response.body.likes, `${origin}/user/${username}/${type}/${nanoid}/likes`)
    })
    it('should return an object with the right shares', async () => {
      assert.strictEqual(typeof response.body.shares, 'string')
      assert.strictEqual(response.body.shares, `${origin}/user/${username}/${type}/${nanoid}/shares`)
    })
  })

  for (const collection of ['replies', 'likes', 'shares', 'thread']) {
    it(`GET ${collection} page Number.MAX_SAFE_INTEGER should return 404 Not Found`, async () => {
      const response = await request(app).get(`/user/${username}/${type}/${nanoid}/${collection}/${Number.MAX_SAFE_INTEGER}`)
      assert.strictEqual(response.status, 404)
    })

    for (const page of ['abc', '-1', '0', '1abc', '18446744073709551617', '01', '+1', '1.5', '1e2', '0x10', ' 1', '1 ', '1\n', '9007199254740992', '9'.repeat(400)]) {
      it(`GET ${collection} page ${JSON.stringify(page)} should return 400 Bad Request`, async () => {
        const response = await request(app).get(`/user/${username}/${type}/${nanoid}/${collection}/${encodeURIComponent(page)}`)
        assert.strictEqual(response.status, 400)
      })
    }

    for (const count of [0, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE + 1]) {
      it(`GET ${collection} with ${count} members uses the inline threshold`, async () => {
        const { objectStorage, formatter, connection } = app.locals
        const parentNanoid = makeNanoid()
        const id = formatter.format({ username, type: 'note', nanoid: parentNanoid })
        const parent = await as2.import({
          id,
          type: 'Note',
          attributedTo: formatter.format({ username }),
          to: 'as:Public'
        })
        await objectStorage.create(parent)
        const ids = []
        for (let i = 0; i < count; i++) {
          const member = await as2.import({
            id: `https://${REMOTE_HOST}/inline/${parentNanoid}/${String(i).padStart(3, '0')}`,
            type: collection === 'likes' ? 'Like' : collection === 'shares' ? 'Announce' : 'Note'
          })
          ids.push(member.id)
          await objectStorage.addToCollection(id, collection, member)
        }
        await connection.query(
          'UPDATE pages SET createdAt = ? WHERE id = ? AND property = ?',
          { replacements: ['2020-01-01T00:00:00Z', id, collection] }
        )
        const response = await request(app).get(`/user/${username}/note/${parentNanoid}/${collection}`)
        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.body.type, 'OrderedCollection')
        assert.strictEqual(response.body.totalItems, count)
        assert.strictEqual(response.body.items, undefined)
        if (count > MAX_PAGE_SIZE) {
          assert.strictEqual(typeof response.body.first, 'string')
          assert.strictEqual(response.body.orderedItems, undefined)
        } else {
          assert.strictEqual(response.body.first, undefined)
          assert.deepStrictEqual(response.body.orderedItems, count === 0 ? undefined : ids.reverse())
        }
      })
    }
  }

  describe('GET /user/{username}/{type}/{nanoid}/replies', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/replies`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/replies`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollection')
    })
    it('should return an object with the right totalItems', async () => {
      assert.strictEqual(typeof response.body.totalItems, 'number')
      assert.strictEqual(response.body.totalItems, 1)
    })
    it('should omit first for inline members', async () => {
      assert.strictEqual(response.body.first, undefined)
    })
    it('should include orderedItems in the collection', async () => {
      assert.strictEqual(response.body.items, undefined)
      assert.deepStrictEqual(response.body.orderedItems, [reply.id])
    })
    it('should return an object with the right repliesOf', async () => {
      assert.strictEqual(typeof response.body.repliesOf, 'string')
      assert.strictEqual(response.body.repliesOf, `${origin}/user/${username}/${type}/${nanoid}`)
    })
    it('should return an object with a published timestamp', async () => {
      assert.strictEqual(typeof response.body.published, 'string')
      assert.ok(response.body.published.match(DATE_FORMAT))
    })
    it('should return an object with an updated timestamp', async () => {
      assert.strictEqual(typeof response.body.updated, 'string')
      assert.ok(response.body.updated.match(DATE_FORMAT))
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/replies/1', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/replies/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/replies/1`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollectionPage')
    })
    it('should return an object with the right partOf', async () => {
      assert.strictEqual(typeof response.body.partOf, 'string')
      assert.strictEqual(response.body.partOf, `${origin}/user/${username}/${type}/${nanoid}/replies`)
    })
    it('should return an object with the right orderedItems', async () => {
      assert.ok(Array.isArray(response.body.orderedItems))
      assert.strictEqual(response.body.items, undefined)
      assert.strictEqual(response.body.orderedItems.length, 1)
      assert.strictEqual(response.body.orderedItems[0], reply.id)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/likes', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/likes`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/likes`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollection')
    })
    it('should return an object with the right totalItems', async () => {
      assert.strictEqual(typeof response.body.totalItems, 'number')
      assert.strictEqual(response.body.totalItems, 1)
    })
    it('should omit first for inline members', async () => {
      assert.strictEqual(response.body.first, undefined)
    })
    it('should include orderedItems in the collection', async () => {
      assert.strictEqual(response.body.items, undefined)
      assert.deepStrictEqual(response.body.orderedItems, [like.id])
    })
    it('should return an object with the right likesOf', async () => {
      assert.strictEqual(typeof response.body.likesOf, 'string')
      assert.strictEqual(response.body.likesOf, `${origin}/user/${username}/${type}/${nanoid}`)
    })
    it('should return an object with a published timestamp', async () => {
      assert.strictEqual(typeof response.body.published, 'string')
      assert.ok(response.body.published.match(DATE_FORMAT))
    })
    it('should return an object with an updated timestamp', async () => {
      assert.strictEqual(typeof response.body.updated, 'string')
      assert.ok(response.body.updated.match(DATE_FORMAT))
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/likes/1', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/likes/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/likes/1`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollectionPage')
    })
    it('should return an object with the right partOf', async () => {
      assert.strictEqual(typeof response.body.partOf, 'string')
      assert.strictEqual(response.body.partOf, `${origin}/user/${username}/${type}/${nanoid}/likes`)
    })
    it('should return an object with the right orderedItems', async () => {
      assert.ok(Array.isArray(response.body.orderedItems))
      assert.strictEqual(response.body.items, undefined)
      assert.strictEqual(response.body.orderedItems.length, 1)
      assert.strictEqual(response.body.orderedItems[0], like.id)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/shares', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/shares`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/shares`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollection')
    })
    it('should return an object with the right totalItems', async () => {
      assert.strictEqual(typeof response.body.totalItems, 'number')
      assert.strictEqual(response.body.totalItems, 1)
    })
    it('should omit first for inline members', async () => {
      assert.strictEqual(response.body.first, undefined)
    })
    it('should include orderedItems in the collection', async () => {
      assert.strictEqual(response.body.items, undefined)
      assert.deepStrictEqual(response.body.orderedItems, [share.id])
    })
    it('should return an object with the right sharesOf', async () => {
      assert.strictEqual(typeof response.body.sharesOf, 'string')
      assert.strictEqual(response.body.sharesOf, `${origin}/user/${username}/${type}/${nanoid}`)
    })
    it('should return an object with a published timestamp', async () => {
      assert.strictEqual(typeof response.body.published, 'string')
      assert.ok(response.body.published.match(DATE_FORMAT))
    })
    it('should return an object with an updated timestamp', async () => {
      assert.strictEqual(typeof response.body.updated, 'string')
      assert.ok(response.body.updated.match(DATE_FORMAT))
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/shares/1', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/shares/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/shares/1`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollectionPage')
    })
    it('should return an object with the right partOf', async () => {
      assert.strictEqual(typeof response.body.partOf, 'string')
      assert.strictEqual(response.body.partOf, `${origin}/user/${username}/${type}/${nanoid}/shares`)
    })
    it('should return an object with the right orderedItems', async () => {
      assert.ok(Array.isArray(response.body.orderedItems))
      assert.strictEqual(response.body.items, undefined)
      assert.strictEqual(response.body.orderedItems.length, 1)
      assert.strictEqual(response.body.orderedItems[0], share.id)
    })
  })

  describe('Get private object anonymously', async () => {
    let response = null
    const url = `/user/${username}/${type}/${privateNanoid}`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })

  describe('Get private object collection anonymously', async () => {
    let response = null
    const url = `/user/${username}/${type}/${privateNanoid}/replies`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })

  describe('Get private object collection page anonymously', async () => {
    let response = null
    const url = `/user/${username}/${type}/${privateNanoid}/replies/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })

  describe('Get private object with follower', async () => {
    let response = null
    it('should work without an error', async () => {
      const path = `/user/${username}/${type}/${privateNanoid}`
      const url = `${origin}${path}`
      const date = new Date().toISOString()
      const signature = await nockSignature({
        username: REMOTE_FOLLOWER_USERNAME,
        domain: REMOTE_HOST,
        url,
        date
      })
      response = await request(app)
        .get(path)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/thread', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/thread`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/thread`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollection')
    })
    it('should return an object with the right totalItems', async () => {
      assert.strictEqual(typeof response.body.totalItems, 'number')
      assert.strictEqual(response.body.totalItems, 2)
    })
    it('should omit first for inline members', async () => {
      assert.strictEqual(response.body.first, undefined)
    })
    it('should include orderedItems in the collection', async () => {
      assert.strictEqual(response.body.items, undefined)
      assert.deepStrictEqual(response.body.orderedItems, [reply.id, obj.id])
    })
    it('should return an object with the right root', async () => {
      assert.strictEqual(typeof response.body.root, 'string')
      assert.strictEqual(response.body.root, `${origin}/user/${username}/${type}/${nanoid}`)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/thread/1', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/thread/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `${origin}/user/${username}/${type}/${nanoid}/thread/1`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollectionPage')
    })
    it('should return an object with the right partOf', async () => {
      assert.strictEqual(typeof response.body.partOf, 'string')
      assert.strictEqual(response.body.partOf, `${origin}/user/${username}/${type}/${nanoid}/thread`)
    })
    it('should return an object with the right orderedItems', async () => {
      assert.ok(Array.isArray(response.body.orderedItems))
      assert.strictEqual(response.body.items, undefined)
      assert.strictEqual(response.body.orderedItems.length, 2)
      assert.strictEqual(response.body.orderedItems[0], reply.id)
      assert.strictEqual(response.body.orderedItems[1], obj.id)
    })
  })

  describe('Get an announce of blocked-domain content anonymously', async () => {
    let response = null
    const url = `/user/${username}/${type}/${blockedNanoid}`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })

  const itemIds = (body) => {
    assert.ok(Array.isArray(body.orderedItems))
    assert.strictEqual(body.items, undefined)
    return body.orderedItems.map(i => (typeof i === 'string' ? i : i.id))
  }

  describe('GET replies excludes a reply from a blocked domain', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${username}/${type}/${subNanoid}/replies`)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should not include the blocked-domain reply', async () => {
      const items = itemIds(response.body)
      assert.ok(!items.includes(subBlockedReply.id), `blocked reply should be excluded; got ${JSON.stringify(items)}`)
    })
    it('should still include the non-blocked reply', async () => {
      const items = itemIds(response.body)
      assert.ok(items.includes(subNormalReply.id), `normal reply should be present; got ${JSON.stringify(items)}`)
    })
  })

  describe('GET likes excludes a like from a blocked domain', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${username}/${type}/${subNanoid}/likes`)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should not include the blocked-domain like', async () => {
      const items = itemIds(response.body)
      assert.ok(!items.includes(subBlockedLike.id), `blocked like should be excluded; got ${JSON.stringify(items)}`)
    })
    it('should still include the non-blocked like', async () => {
      const items = itemIds(response.body)
      assert.ok(items.includes(subNormalLike.id), `normal like should be present; got ${JSON.stringify(items)}`)
    })
  })

  describe('GET shares excludes a share from a blocked domain', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${username}/${type}/${subNanoid}/shares`)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should not include the blocked-domain share', async () => {
      const items = itemIds(response.body)
      assert.ok(!items.includes(subBlockedShare.id), `blocked share should be excluded; got ${JSON.stringify(items)}`)
    })
    it('should still include the non-blocked share', async () => {
      const items = itemIds(response.body)
      assert.ok(items.includes(subNormalShare.id), `normal share should be present; got ${JSON.stringify(items)}`)
    })
  })

  describe('GET thread excludes a reply from a blocked domain', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${username}/${type}/${subNanoid}/thread`)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should not include the blocked-domain reply', async () => {
      const items = itemIds(response.body)
      assert.ok(!items.includes(subBlockedReply.id), `blocked reply should be excluded from thread; got ${JSON.stringify(items)}`)
    })
    it('should still include the non-blocked reply', async () => {
      const items = itemIds(response.body)
      assert.ok(items.includes(subNormalReply.id), `normal reply should be present in thread; got ${JSON.stringify(items)}`)
    })
  })
})

describe('object collection seekItem routes', () => {
  const localDomain = 'local.routes-object-seekitem.test'
  const remoteDomains = ['remote.routes-seekitem.test', 'https://blocked-one.test/users']
  const origin = `https://${localDomain}`
  const username = 'routesobjectseekitemtest'
  const collections = ['replies', 'shares', 'likes', 'thread']
  const fixtures = new Map()
  let app

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      allowPrivateNetworkRequests: true,
      origin,
      databaseUrl: getTestDatabaseUrl(),
      redisUrl: getTestRedisUrl(),
      bots: { [username]: new DoNothingBot(username) },
      domainBlockFileName: fileURLToPath(new URL('./fixtures/blocklist-basic.csv', import.meta.url)),
      logLevel: 'silent'
    })
    await cleanupTestData(app.locals.connection, { usernames: [username], localDomain, remoteDomains })
    const { formatter, objectStorage } = app.locals
    const owner = formatter.format({ username })

    for (const collection of collections) {
      const hasActors = ['followers', 'following'].includes(collection)
      const type = hasActors ? 'Person' : collection === 'outbox' ? 'IntransitiveActivity' : collection === 'likes' ? 'Like' : collection === 'shares' ? 'Announce' : 'Note'
      const parent = await as2.import({
        id: formatter.format({ username, type: 'note', nanoid: makeNanoid() }),
        type: 'Note',
        attributedTo: owner,
        to: 'as:Public'
      })
      const privateParent = await as2.import({
        id: formatter.format({ username, type: 'note', nanoid: makeNanoid() }),
        type: 'Note',
        attributedTo: owner,
        to: owner
      })
      await objectStorage.create(parent)
      await objectStorage.create(privateParent)
      const members = {}
      for (const visibility of ['readable', 'missing', 'unreadable']) {
        const member = await as2.import({
          id: hasActors
            ? `https://${visibility === 'unreadable' ? 'blocked-one.test' : 'remote.routes-seekitem.test'}/users/${collection}-${visibility}`
            : formatter.format({ username, type: type.toLowerCase(), nanoid: makeNanoid() }),
          type,
          attributedTo: owner,
          actor: ['IntransitiveActivity', 'Like', 'Announce'].includes(type) ? owner : undefined,
          object: ['Like', 'Announce'].includes(type) ? parent.id : undefined,
          inReplyTo: collection === 'replies' ? parent.id : undefined,
          to: visibility === 'unreadable' ? owner : 'as:Public'
        })
        await objectStorage.create(member)
        members[visibility] = member
        if (visibility !== 'missing') {
          await objectStorage.addToCollection(parent.id, collection, member)
          await objectStorage.addToCollection(privateParent.id, collection, member)
        }
      }
      fixtures.set(collection, {
        ...members,
        id: `${parent.id}/${collection}`,
        privateParent
      })
    }
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) return
    try {
      await cleanupTestData(app.locals.connection, { domainBlockFiles: [BASIC_BLOCKLIST], usernames: [username], localDomain, remoteDomains })
    } finally {
      await app.cleanup()
    }
  })

  corsTests(() => app, () => collections.flatMap(collection => [
    {
      name: `${collection} seekItem redirect`,
      path: () => `${localPath(fixtures.get(collection).id)}/seekItem?item=${encodeURIComponent(fixtures.get(collection).readable.id)}`,
      status: 307
    },
    {
      name: `${collection} seekItem missing member`,
      path: () => `${localPath(fixtures.get(collection).id)}/seekItem?item=${encodeURIComponent(fixtures.get(collection).missing.id)}`,
      status: 404
    }
  ]))

  function localPath (url) {
    const parsed = new URL(url)
    assert.strictEqual(parsed.origin, origin)
    return parsed.pathname + parsed.search
  }

  async function seek (collection, item) {
    const response = await request(app).get(localPath(fixtures.get(collection).id))
    assert.strictEqual(response.status, 200)
    assert.strictEqual(typeof response.body.seekItem, 'string', 'collection must advertise seekItem')
    const endpoint = new URL(response.body.seekItem)
    endpoint.searchParams.set('item', item.id)
    return request(app).get(localPath(endpoint))
  }

  function assertNotFound (response) {
    assert.strictEqual(response.status, 404)
    assert.strictEqual(response.type, 'application/problem+json')
    assert.strictEqual(response.body.status, 404)
    assert.strictEqual(response.headers.location, undefined)
  }

  for (const collection of collections) {
    describe(collection, () => {
      it('advertises an HTTPS seekItem endpoint', async () => {
        const response = await request(app).get(localPath(fixtures.get(collection).id))
        assert.strictEqual(response.status, 200)
        assert.strictEqual(typeof response.body.seekItem, 'string')
        assert.strictEqual(new URL(response.body.seekItem).protocol, 'https:')
      })

      it('redirects to the collection containing a readable inline member', async () => {
        const { id, readable } = fixtures.get(collection)
        const response = await seek(collection, readable)
        assert.ok([307, 308].includes(response.status), `expected redirect, got ${response.status}`)
        assert.strictEqual(response.headers.location, id)
        const target = await request(app).get(localPath(response.headers.location))
        assert.strictEqual(target.status, 200)
        assert.strictEqual(target.type, 'application/activity+json')
        assert.strictEqual(target.body.id, id)
        assert.ok(target.body.orderedItems.includes(readable.id))
      })

      it('returns 404 for a readable item that is not a member', async () => {
        assertNotFound(await seek(collection, fixtures.get(collection).missing))
      })

      it('returns 404 for a member unreadable by the anonymous principal', async () => {
        assertNotFound(await seek(collection, fixtures.get(collection).unreadable))
      })

      if (['replies', 'shares', 'likes'].includes(collection)) {
        it('returns 404 when the collection is unreadable even if the member is public', async () => {
          const { privateParent, readable } = fixtures.get(collection)
          assert.strictEqual(await app.locals.authorizer.canRead(null, privateParent), false)
          assert.strictEqual(await app.locals.authorizer.canRead(null, readable), true)
          // Discover the private endpoint internally because its collection cannot be fetched anonymously.
          const stored = await app.locals.objectStorage.getCollection(privateParent.id, collection)
          const exported = await stored.export({ useOriginalContext: true })
          assert.strictEqual(typeof exported.seekItem, 'string', 'private collection must advertise seekItem')
          const endpoint = new URL(exported.seekItem)
          endpoint.searchParams.set('item', readable.id)
          assertNotFound(await request(app).get(localPath(endpoint)))
        })
      }
    })
  }
})
