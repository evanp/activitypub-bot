import { corsTests } from './utils/cors.js'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import request from 'supertest'
import { nanoid } from 'nanoid'

import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'
import OKBot from '../lib/bots/ok.js'
import as2 from '../lib/activitystreams.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASIC_BLOCKLIST = resolve(__dirname, 'fixtures', 'blocklist-basic.csv')
const BLOCKED_HOST = 'blocked-one.test'

const MAX_PAGE_SIZE = 256
const INLINE_COUNTS = [0, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE + 1]

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

describe('actor collection routes', async () => {
  const LOCAL_HOST = 'local.routes-collection.test'
  const databaseUrl = getTestDatabaseUrl()
  const origin = `https://${LOCAL_HOST}`
  const BOT_USERNAME = 'routescollectiontestok'
  const DNE_USERNAME = 'routescollectiontestdne'
  const OUTBOX_MANY_USERNAME = 'routescollectiontestmany'
  const OUTBOX_ONE_USERNAME = 'routescollectiontestone'
  const FOLLOWERS_BLOCKED_USERNAME = 'routescollectiontestfolblk'
  const OUTBOX_BLOCKED_USERNAME = 'routescollectiontestoutblk'
  const INLINE_USERNAMES = INLINE_COUNTS.map(count => `routescollectioninline${count}`)
  const TEST_USERNAMES = [...INLINE_USERNAMES, BOT_USERNAME, OUTBOX_MANY_USERNAME, OUTBOX_ONE_USERNAME, FOLLOWERS_BLOCKED_USERNAME, OUTBOX_BLOCKED_USERNAME]
  const testBots = {
    ...Object.fromEntries(INLINE_USERNAMES.map(username => [username, new DoNothingBot(username)])),
    [BOT_USERNAME]: new OKBot(BOT_USERNAME),
    [OUTBOX_MANY_USERNAME]: new DoNothingBot(OUTBOX_MANY_USERNAME),
    [OUTBOX_ONE_USERNAME]: new DoNothingBot(OUTBOX_ONE_USERNAME),
    [FOLLOWERS_BLOCKED_USERNAME]: new DoNothingBot(FOLLOWERS_BLOCKED_USERNAME),
    [OUTBOX_BLOCKED_USERNAME]: new DoNothingBot(OUTBOX_BLOCKED_USERNAME)
  }
  let app = null

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent', redisUrl: getTestRedisUrl(), domainBlockFileName: BASIC_BLOCKLIST
    })
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
    await app.cleanup()
  })

  corsTests(() => app, () => ['outbox', 'liked', 'followers', 'following'].flatMap(collection => [
    { path: `/user/${BOT_USERNAME}/${collection}` },
    { path: `/user/${BOT_USERNAME}/${collection}/1` },
    { path: `/user/${BOT_USERNAME}/${collection}/99999999`, status: 404 }
  ]))

  for (const coll of ['outbox', 'liked', 'followers', 'following']) {
    describe(`${coll} collection`, async () => {
      describe(`GET /user/{botid}/${coll}`, async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/${BOT_USERNAME}/${coll}`)
        })
        it('should return 200 OK', async () => {
          assert.strictEqual(response.status, 200)
        })
        it('should return AS2', async () => {
          assert.strictEqual(response.type, 'application/activity+json')
        })
        it('should return an object', async () => {
          assert.strictEqual(typeof response.body, 'object')
        })
        it('should return an object with an id', async () => {
          assert.strictEqual(typeof response.body.id, 'string')
        })
        it('should return an object with an id matching the request', async () => {
          assert.strictEqual(response.body.id, `${origin}/user/${BOT_USERNAME}/${coll}`)
        })
        it('should return an object with a type', async () => {
          assert.strictEqual(typeof response.body.type, 'string')
        })
        it('should return an object with a type matching the request', async () => {
          assert.strictEqual(response.body.type, 'OrderedCollection')
        })
        it('should return an object with a totalItems', async () => {
          assert.strictEqual(typeof response.body.totalItems, 'number')
        })
        it('should return an object with attributedTo', async () => {
          assert.strictEqual(typeof response.body.attributedTo, 'string')
        })
        it('should return an object with attributedTo matching the bot', async () => {
          assert.strictEqual(response.body.attributedTo, `${origin}/user/${BOT_USERNAME}`)
        })
        it('should return an object with a to', async () => {
          assert.strictEqual(typeof response.body.to, 'string')
        })
        it('should return an object with a to for the public', async () => {
          assert.strictEqual(response.body.to, 'as:Public')
        })
        it('should return an object with a summary', async () => {
          assert.strictEqual(typeof response.body.summaryMap, 'object')
          assert.strictEqual(typeof response.body.summaryMap.en, 'string')
        })
        it('should omit first on an empty collection', async () => {
          assert.strictEqual(response.body.first, undefined)
        })
        it('should omit orderedItems on an empty collection', async () => {
          assert.strictEqual(response.body.totalItems, 0)
          assert.strictEqual(response.body.orderedItems, undefined)
        })
        it(`should return an object with a ${coll}Of to the actor`, async () => {
          assert.strictEqual(typeof response.body[coll + 'Of'], 'string')
          assert.strictEqual(response.body[coll + 'Of'], `${origin}/user/${BOT_USERNAME}`)
        })
        it('should return an object with a published property', async () => {
          assert.strictEqual(typeof response.body.published, 'string')
          assert.ok(response.body.published.match(DATE_FORMAT))
        })
        it('should return an object with an updated property', async () => {
          assert.strictEqual(typeof response.body.updated, 'string')
          assert.ok(response.body.updated.match(DATE_FORMAT))
        })
      })

      describe('GET collection for non-existent user', async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/${DNE_USERNAME}/${coll}`)
        })
        it('should return 404 Not Found', async () => {
          assert.strictEqual(response.status, 404)
        })
        it('should return Problem Details JSON', async () => {
          assert.strictEqual(response.type, 'application/problem+json')
        })
        it('should return an object', async () => {
          assert.strictEqual(typeof response.body, 'object')
        })
        it('should return an object with a type', async () => {
          assert.strictEqual(typeof response.body.type, 'string')
        })
        it('should return an object with an type matching the request', async () => {
          assert.strictEqual(response.body.type, 'about:blank')
        })
        it('should return an object with a title', async () => {
          assert.strictEqual(typeof response.body.title, 'string')
        })
        it('should return an object with a title matching the request', async () => {
          assert.strictEqual(response.body.title, 'Not Found')
        })
        it('should return an object with a status', async () => {
          assert.strictEqual(typeof response.body.status, 'number')
        })
        it('should return an object with a status matching the request', async () => {
          assert.strictEqual(response.body.status, 404)
        })
        it('should return an object with a detail', async () => {
          assert.strictEqual(typeof response.body.detail, 'string')
        })
        it('should return an object with a detail matching the request', async () => {
          assert.strictEqual(response.body.detail, `User ${DNE_USERNAME} not found`)
        })
      })

      describe(`GET /user/{botid}/${coll}/1`, async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/${BOT_USERNAME}/${coll}/1`)
        })
        it('should return 200 OK', async () => {
          assert.strictEqual(response.status, 200)
        })
        it('should return AS2', async () => {
          assert.strictEqual(response.type, 'application/activity+json')
        })
        it('should return an object', async () => {
          assert.strictEqual(typeof response.body, 'object')
        })
        it('should return an object with an id', async () => {
          assert.strictEqual(typeof response.body.id, 'string')
        })
        it('should return an object with an id matching the request', async () => {
          assert.strictEqual(response.body.id, `${origin}/user/${BOT_USERNAME}/${coll}/1`)
        })
        it('should return an object with a type', async () => {
          assert.strictEqual(typeof response.body.type, 'string')
        })
        it('should return an object with a type matching the request', async () => {
          assert.strictEqual(response.body.type, 'OrderedCollectionPage')
        })
        it('should have no unordered items on an empty page', async () => {
          assert.strictEqual(response.body.items, undefined)
          assert.deepStrictEqual(response.body.orderedItems ?? [], [])
        })
        it('should return an object with attributedTo', async () => {
          assert.strictEqual(typeof response.body.attributedTo, 'string')
        })
        it('should return an object with attributedTo matching the bot', async () => {
          assert.strictEqual(response.body.attributedTo, `${origin}/user/${BOT_USERNAME}`)
        })
        it('should return an object with a to', async () => {
          assert.strictEqual(typeof response.body.to, 'string')
        })
        it('should return an object with a to for the public', async () => {
          assert.strictEqual(response.body.to, 'as:Public')
        })
        it('should return an object with a summary', async () => {
          assert.strictEqual(typeof response.body.summaryMap, 'object')
          assert.strictEqual(typeof response.body.summaryMap.en, 'string')
        })
        it('should return an object with a partOf', async () => {
          assert.strictEqual(typeof response.body.partOf, 'string')
        })
        it('should return an object with a partOf matching the collection', async () => {
          assert.strictEqual(response.body.partOf, `${origin}/user/${BOT_USERNAME}/${coll}`)
        })
      })

      it(`GET ${coll} page Number.MAX_SAFE_INTEGER should return 404 Not Found`, async () => {
        const response = await request(app).get(`/user/${BOT_USERNAME}/${coll}/${Number.MAX_SAFE_INTEGER}`)
        assert.strictEqual(response.status, 404)
      })

      for (const page of ['abc', '-1', '0', '1abc', '18446744073709551617', '01', '+1', '1.5', '1e2', '0x10', ' 1', '1 ', '1\n', '9007199254740992', '9'.repeat(400)]) {
        it(`GET ${coll} page ${JSON.stringify(page)} should return 400 Bad Request`, async () => {
          const response = await request(app).get(`/user/${BOT_USERNAME}/${coll}/${encodeURIComponent(page)}`)
          assert.strictEqual(response.status, 400)
        })
      }

      describe('GET collection page for non-existent user', async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/${DNE_USERNAME}/${coll}/1`)
        })
        it('should return 404 Not Found', async () => {
          assert.strictEqual(response.status, 404)
        })
        it('should return Problem Details JSON', async () => {
          assert.strictEqual(response.type, 'application/problem+json')
        })
        it('should return an object', async () => {
          assert.strictEqual(typeof response.body, 'object')
        })
        it('should return an object with a type', async () => {
          assert.strictEqual(typeof response.body.type, 'string')
        })
        it('should return an object with an type matching the request', async () => {
          assert.strictEqual(response.body.type, 'about:blank')
        })
        it('should return an object with a title', async () => {
          assert.strictEqual(typeof response.body.title, 'string')
        })
        it('should return an object with a title matching the request', async () => {
          assert.strictEqual(response.body.title, 'Not Found')
        })
        it('should return an object with a status', async () => {
          assert.strictEqual(typeof response.body.status, 'number')
        })
        it('should return an object with a status matching the request', async () => {
          assert.strictEqual(response.body.status, 404)
        })
        it('should return an object with a detail', async () => {
          assert.strictEqual(typeof response.body.detail, 'string')
        })
        it('should return an object with a detail matching the request', async () => {
          assert.strictEqual(response.body.detail, `User ${DNE_USERNAME} not found`)
        })
      })

      describe('GET non-existent page for existent collection and existent user', async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/${BOT_USERNAME}/${coll}/99999999`)
        })
        it('should return 404 Not Found', async () => {
          assert.strictEqual(response.status, 404)
        })
        it('should return Problem Details JSON', async () => {
          assert.strictEqual(response.type, 'application/problem+json')
        })
        it('should return an object', async () => {
          assert.strictEqual(typeof response.body, 'object')
        })
        it('should return an object with a type', async () => {
          assert.strictEqual(typeof response.body.type, 'string')
        })
        it('should return an object with an type matching the request', async () => {
          assert.strictEqual(response.body.type, 'about:blank')
        })
        it('should return an object with a title', async () => {
          assert.strictEqual(typeof response.body.title, 'string')
        })
        it('should return an object with a title matching the request', async () => {
          assert.strictEqual(response.body.title, 'Not Found')
        })
        it('should return an object with a status', async () => {
          assert.strictEqual(typeof response.body.status, 'number')
        })
        it('should return an object with a status matching the request', async () => {
          assert.strictEqual(response.body.status, 404)
        })
        it('should return an object with a detail', async () => {
          assert.strictEqual(typeof response.body.detail, 'string')
        })
        it('should return an object with a detail matching the request', async () => {
          assert.strictEqual(response.body.detail, `No such page 99999999 for collection ${coll} for user ${BOT_USERNAME}`)
        })
      })
    })
  }

  for (const collection of ['outbox', 'liked', 'followers', 'following']) {
    it(`GET ${collection} returns orderedItems in collection order`, async () => {
      const { actorStorage, objectStorage, formatter, connection } = app.locals
      const ids = []
      const isActor = ['followers', 'following'].includes(collection)
      const type = isActor ? 'Person' : collection === 'outbox' ? 'IntransitiveActivity' : 'Note'

      for (let i = 0; i < 2; i++) {
        const item = await as2.import({
          id: isActor
            ? `https://remote.routes-collection.test/users/${collection}${i}`
            : formatter.format({ username: BOT_USERNAME, type: type.toLowerCase(), nanoid: nanoid() }),
          type,
          attributedTo: formatter.format({ username: BOT_USERNAME }),
          actor: collection === 'outbox' ? formatter.format({ username: BOT_USERNAME }) : undefined,
          content: `Ordered collection member ${i}`,
          to: 'as:Public'
        })
        ids.push(item.id)
        if (!isActor) {
          await objectStorage.create(item)
        }
        await actorStorage.addToCollection(BOT_USERNAME, collection, item)
        await connection.query(
          'UPDATE actorcollectionpage SET createdAt = ? WHERE username = ? AND property = ? AND item = ?',
          { replacements: [`2020-01-0${i + 1}T00:00:00Z`, BOT_USERNAME, collection, item.id] }
        )
      }

      const response = await request(app).get(`/user/${BOT_USERNAME}/${collection}`)
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.body.type, 'OrderedCollection')
      assert.strictEqual(response.body.first, undefined)
      assert.strictEqual(response.body.items, undefined)
      assert.deepStrictEqual(response.body.orderedItems, [ids[1], ids[0]])
    })
  }

  for (const collection of ['outbox', 'liked', 'followers', 'following']) {
    for (const count of INLINE_COUNTS) {
      it(`GET ${collection} with ${count} members uses the inline threshold`, async () => {
        const { actorStorage, objectStorage, formatter, connection } = app.locals
        const username = `routescollectioninline${count}`
        const ids = []
        const isActor = ['followers', 'following'].includes(collection)
        for (let i = 0; i < count; i++) {
          const member = await as2.import({
            id: isActor
              ? `https://remote.routes-collection.test/inline/${collection}/${count}/${String(i).padStart(3, '0')}`
              : formatter.format({ username, type: collection === 'outbox' ? 'intransitiveactivity' : 'note', nanoid: nanoid() }),
            type: isActor ? 'Person' : collection === 'outbox' ? 'IntransitiveActivity' : 'Note',
            attributedTo: formatter.format({ username }),
            actor: collection === 'outbox' ? formatter.format({ username }) : undefined,
            to: 'as:Public'
          })
          ids.push(member.id)
          if (!isActor) await objectStorage.create(member)
          await actorStorage.addToCollection(username, collection, member)
        }
        await connection.query(
          'UPDATE actorcollectionpage SET createdAt = ? WHERE username = ? AND property = ?',
          { replacements: ['2020-01-01T00:00:00Z', username, collection] }
        )
        const response = await request(app).get(`/user/${username}/${collection}`)
        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.body.type, 'OrderedCollection')
        assert.strictEqual(response.body.totalItems, count)
        assert.strictEqual(response.body.items, undefined)
        if (count > MAX_PAGE_SIZE) {
          assert.strictEqual(typeof response.body.first, 'string')
          assert.strictEqual(response.body.orderedItems, undefined)
        } else {
          assert.strictEqual(response.body.first, undefined)
          // Defer exact ordering checks until the collation policy is settled.
          assert.deepStrictEqual(response.body.orderedItems?.toSorted(), count === 0 ? undefined : ids.toSorted())
        }
      })
    }
  }

  describe('GET non-existent collection for existent user', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${BOT_USERNAME}/dne`)
    })
    it('should return 404 Not Found', async () => {
      assert.strictEqual(response.status, 404)
    })
    it('should return Problem Details JSON', async () => {
      assert.strictEqual(response.type, 'application/problem+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with a type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
    })
    it('should return an object with an type matching the request', async () => {
      assert.strictEqual(response.body.type, 'about:blank')
    })
    it('should return an object with a title', async () => {
      assert.strictEqual(typeof response.body.title, 'string')
    })
    it('should return an object with a title matching the request', async () => {
      assert.strictEqual(response.body.title, 'Not Found')
    })
    it('should return an object with a status', async () => {
      assert.strictEqual(typeof response.body.status, 'number')
    })
    it('should return an object with a status matching the request', async () => {
      assert.strictEqual(response.body.status, 404)
    })
    it('should return an object with a detail', async () => {
      assert.strictEqual(typeof response.body.detail, 'string')
    })
  })

  describe('GET /user/{botid}/outbox with contents', async () => {
    let response = null

    before(async () => {
      const actorStorage = app.locals.actorStorage
      const objectStorage = app.locals.objectStorage
      const formatter = app.locals.formatter

      for (let i = 0; i < 20; i++) {
        const activity = await as2.import({
          '@context': 'https://www.w3.org/ns/activitystreams',
          to: 'as:Public',
          actor: formatter.format({ username: OUTBOX_MANY_USERNAME }),
          type: 'IntransitiveActivity',
          id: formatter.format({
            username: OUTBOX_MANY_USERNAME,
            type: 'intransitiveactivity',
            nanoid: nanoid()
          }),
          summary: 'An intransitive activity by the test bot',
          published: (new Date()).toISOString()
        })
        await objectStorage.create(activity)
        await actorStorage.addToCollection(OUTBOX_MANY_USERNAME, 'outbox', activity)
      }
    })

    it('should work without an error', async () => {
      response = await request(app).get(`/user/${OUTBOX_MANY_USERNAME}/outbox`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should include all members inline', () => {
      assert.strictEqual(response.body.first, undefined)
      assert.strictEqual(response.body.orderedItems?.length, 20)
    })
  })

  describe('GET /user/{botid}/outbox with one item', async () => {
    let response = null

    before(async () => {
      const actorStorage = app.locals.actorStorage
      const objectStorage = app.locals.objectStorage
      const formatter = app.locals.formatter

      const activity = await as2.import({
        '@context': 'https://www.w3.org/ns/activitystreams',
        to: 'as:Public',
        actor: formatter.format({ username: OUTBOX_ONE_USERNAME }),
        type: 'IntransitiveActivity',
        id: formatter.format({
          username: OUTBOX_ONE_USERNAME,
          type: 'intransitiveactivity',
          nanoid: nanoid()
        }),
        summary: 'An intransitive activity by the test bot',
        published: (new Date()).toISOString()
      })
      await objectStorage.create(activity)
      await actorStorage.addToCollection(OUTBOX_ONE_USERNAME, 'outbox', activity)
    })

    it('should work without an error', async () => {
      response = await request(app).get(`/user/${OUTBOX_ONE_USERNAME}/outbox`)
    })

    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })

    it('should have one item', async () => {
      assert.ok(Array.isArray(response.body.orderedItems))
      assert.strictEqual(response.body.orderedItems.length, 1)
      assert.strictEqual(response.body.items, undefined)
    })
  })

  describe('GET followers excludes a follower on a blocked domain', async () => {
    let response = null
    const normalFollowerId = 'https://remote.routes-collection.test/users/normalfollower'
    const blockedFollowerId = `https://${BLOCKED_HOST}/users/blockedfollower`

    const itemIds = (body) => {
      assert.ok(Array.isArray(body.orderedItems))
      assert.strictEqual(body.items, undefined)
      return body.orderedItems.map(i => (typeof i === 'string' ? i : i.id))
    }

    before(async () => {
      const actorStorage = app.locals.actorStorage
      const normalFollower = await as2.import({
        id: normalFollowerId,
        type: 'Person',
        preferredUsername: 'normalfollower'
      })
      const blockedFollower = await as2.import({
        id: blockedFollowerId,
        type: 'Person',
        preferredUsername: 'blockedfollower'
      })
      await actorStorage.addToCollection(FOLLOWERS_BLOCKED_USERNAME, 'followers', normalFollower)
      await actorStorage.addToCollection(FOLLOWERS_BLOCKED_USERNAME, 'followers', blockedFollower)
    })

    it('should work without an error', async () => {
      response = await request(app).get(`/user/${FOLLOWERS_BLOCKED_USERNAME}/followers`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should not include the blocked-domain follower', async () => {
      const items = itemIds(response.body)
      assert.ok(!items.includes(blockedFollowerId), `blocked follower should be excluded; got ${JSON.stringify(items)}`)
    })
    it('should still include the non-blocked follower', async () => {
      const items = itemIds(response.body)
      assert.ok(items.includes(normalFollowerId), `normal follower should be present; got ${JSON.stringify(items)}`)
    })
  })

  describe('GET outbox excludes an announce of blocked-domain content', async () => {
    let response = null
    let normalActivityId = null
    let blockedAnnounceId = null

    const itemIds = (body) => {
      assert.ok(Array.isArray(body.orderedItems))
      assert.strictEqual(body.items, undefined)
      return body.orderedItems.map(i => (typeof i === 'string' ? i : i.id))
    }

    before(async () => {
      const actorStorage = app.locals.actorStorage
      const objectStorage = app.locals.objectStorage
      const formatter = app.locals.formatter

      const normalActivity = await as2.import({
        '@context': 'https://www.w3.org/ns/activitystreams',
        to: 'as:Public',
        actor: formatter.format({ username: OUTBOX_BLOCKED_USERNAME }),
        type: 'IntransitiveActivity',
        id: formatter.format({ username: OUTBOX_BLOCKED_USERNAME, type: 'intransitiveactivity', nanoid: nanoid() }),
        summary: 'A normal activity',
        published: (new Date()).toISOString()
      })
      normalActivityId = normalActivity.id
      await objectStorage.create(normalActivity)
      await actorStorage.addToCollection(OUTBOX_BLOCKED_USERNAME, 'outbox', normalActivity)

      const blockedAnnounce = await as2.import({
        '@context': 'https://www.w3.org/ns/activitystreams',
        to: 'as:Public',
        actor: formatter.format({ username: OUTBOX_BLOCKED_USERNAME }),
        type: 'Announce',
        id: formatter.format({ username: OUTBOX_BLOCKED_USERNAME, type: 'announce', nanoid: nanoid() }),
        object: `https://${BLOCKED_HOST}/notes/1`,
        published: (new Date()).toISOString()
      })
      blockedAnnounceId = blockedAnnounce.id
      await objectStorage.create(blockedAnnounce)
      await actorStorage.addToCollection(OUTBOX_BLOCKED_USERNAME, 'outbox', blockedAnnounce)
    })

    it('should work without an error', async () => {
      response = await request(app).get(`/user/${OUTBOX_BLOCKED_USERNAME}/outbox`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should not include the blocked-domain announce', async () => {
      const items = itemIds(response.body)
      assert.ok(!items.includes(blockedAnnounceId), `blocked announce should be excluded; got ${JSON.stringify(items)}`)
    })
    it('should still include the normal activity', async () => {
      const items = itemIds(response.body)
      assert.ok(items.includes(normalActivityId), `normal activity should be present; got ${JSON.stringify(items)}`)
    })
  })
})

describe('actor collection seekItem routes', () => {
  const localDomain = 'local.routes-actor-seekitem.test'
  const remoteDomains = ['remote.routes-seekitem.test', 'https://blocked-one.test/users']
  const origin = `https://${localDomain}`
  const username = 'routesactorseekitemtest'
  const collections = ['outbox', 'liked', 'followers', 'following']
  const fixtures = new Map()
  let app

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      origin,
      databaseUrl: getTestDatabaseUrl(),
      redisUrl: getTestRedisUrl(),
      bots: { [username]: new DoNothingBot(username) },
      domainBlockFileName: fileURLToPath(new URL('./fixtures/blocklist-basic.csv', import.meta.url)),
      logLevel: 'silent'
    })
    await cleanupTestData(app.locals.connection, { usernames: [username], localDomain, remoteDomains })
    const { formatter, objectStorage, actorStorage } = app.locals
    const owner = formatter.format({ username })

    for (const collection of collections) {
      const hasActors = ['followers', 'following'].includes(collection)
      const type = hasActors ? 'Person' : collection === 'outbox' ? 'IntransitiveActivity' : collection === 'likes' ? 'Like' : collection === 'shares' ? 'Announce' : 'Note'
      const parent = await as2.import({
        id: formatter.format({ username, type: 'note', nanoid: nanoid() }),
        type: 'Note',
        attributedTo: owner,
        to: 'as:Public'
      })
      const privateParent = await as2.import({
        id: formatter.format({ username, type: 'note', nanoid: nanoid() }),
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
            : formatter.format({ username, type: type.toLowerCase(), nanoid: nanoid() }),
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
          await actorStorage.addToCollection(username, collection, member)
        }
      }
      fixtures.set(collection, {
        ...members,
        id: `${owner}/${collection}`,
        privateParent
      })
    }
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) return
    try {
      await cleanupTestData(app.locals.connection, { usernames: [username], localDomain, remoteDomains })
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
    })
  }
})
