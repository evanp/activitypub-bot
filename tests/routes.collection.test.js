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
  const TEST_USERNAMES = [BOT_USERNAME, OUTBOX_MANY_USERNAME, OUTBOX_ONE_USERNAME, FOLLOWERS_BLOCKED_USERNAME, OUTBOX_BLOCKED_USERNAME]
  const testBots = {
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
        it('should return an object with a first', async () => {
          assert.strictEqual(typeof response.body.first, 'string')
        })
        it('should return an object with a last', async () => {
          assert.strictEqual(typeof response.body.last, 'string')
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

  describe('GET /user/{botid}/outbox/1 with contents', async () => {
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
      response = await request(app).get(`/user/${OUTBOX_MANY_USERNAME}/outbox/1`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
  })

  describe('GET /user/{botid}/outbox/1 with one item', async () => {
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
      response = await request(app).get(`/user/${OUTBOX_ONE_USERNAME}/outbox/1`)
    })

    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })

    it('should have one item', async () => {
      assert.ok(!Array.isArray(response.body.items) || response.body.items.length === 1)
    })
  })

  describe('GET followers excludes a follower on a blocked domain', async () => {
    let response = null
    const normalFollowerId = 'https://remote.routes-collection.test/users/normalfollower'
    const blockedFollowerId = `https://${BLOCKED_HOST}/users/blockedfollower`

    const itemIds = (body) =>
      (body.items || body.orderedItems || []).map(i => (typeof i === 'string' ? i : i.id))

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
      response = await request(app).get(`/user/${FOLLOWERS_BLOCKED_USERNAME}/followers/1`)
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

    const itemIds = (body) =>
      (body.items || body.orderedItems || []).map(i => (typeof i === 'string' ? i : i.id))

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
      response = await request(app).get(`/user/${OUTBOX_BLOCKED_USERNAME}/outbox/1`)
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
