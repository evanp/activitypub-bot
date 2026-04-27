import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'
import { nockSetup, nockFormat, nockSignature, postInbox } from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'
import as2 from '../lib/activitystreams.js'

import { makeDigest } from './utils/digest.js'
import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const AS = 'https://www.w3.org/ns/activitystreams#'

const FOLLOW_TYPE = `${AS}Follow`
const UNDO_TYPE = `${AS}Undo`

describe('FollowBack bot', async () => {
  const LOCAL_HOST = 'local.bot-followback.test'
  const REMOTE_HOST = 'remote.bot-followback.test'
  const BOT_USERNAME = 'botfollowbacktest'
  const REMOTE_ACTOR = 'botfollowbackremote'
  const REMOTE_ACTOR_2 = 'botfollowbackremote2'
  const TEST_USERNAMES = [BOT_USERNAME]

  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null
  let FollowBackBot

  before(async () => {
    nockSetup(REMOTE_HOST)
  })

  after(async () => {
    await cleanupRedis(origin)
    if (app) {
      await cleanupTestData(app.locals.connection, {
        usernames: TEST_USERNAMES,
        localDomain: LOCAL_HOST,
        remoteDomains: [REMOTE_HOST]
      })
      await app.cleanup()
    }
  })

  describe('Can import and initialize', async () => {
    try {
      FollowBackBot = (await import('../lib/bots/followback.js')).default
    } catch (err) {
      assert.fail(err.message)
    }
    assert.ok(FollowBackBot)
    assert.strictEqual(typeof FollowBackBot, 'function')
    const testBots = {}
    testBots[BOT_USERNAME] = new FollowBackBot(BOT_USERNAME)
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent', redisUrl: getTestRedisUrl()
    })
    assert.ok(app)
  })

  describe('Bot exists', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${BOT_USERNAME}`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
  })

  describe('follows back when followed', async () => {
    const username = REMOTE_ACTOR
    const domain = REMOTE_HOST
    const remoteId = nockFormat({ username, domain })
    const path = `/user/${BOT_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response
    let body
    let signature
    let digest

    before(async () => {
      const { formatter } = app.locals
      const activity = await as2.import({
        type: 'Follow',
        actor: remoteId,
        id: nockFormat({ username, type: 'follow', num: 1, domain }),
        object: formatter.format({ username: BOT_USERNAME }),
        to: formatter.format({ username: BOT_USERNAME }),
        cc: [
          'as:Public',
          nockFormat({ username, collection: 'followers', domain })
        ]
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignature({
        method: 'POST',
        username,
        url,
        digest,
        date,
        domain
      })
    })

    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })

    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202, JSON.stringify(response.body))
    })

    it('should deliver the reciprocal follow to the other actor', async () => {
      assert.strictEqual(postInbox[username], 3)
    })

    it('should have the reciprocal follow in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      let foundActivity
      for await (const item of actorStorage.items(BOT_USERNAME, 'outbox')) {
        const obj = await objectStorage.read(item.id)
        if (obj.type === FOLLOW_TYPE &&
          obj.object?.first?.id === remoteId) {
          foundActivity = obj
          break
        }
      }
      assert.ok(foundActivity)
    })
  })

  describe('unfollows back when unfollowed', async () => {
    const username = REMOTE_ACTOR_2
    const domain = REMOTE_HOST
    const remoteId = nockFormat({ username, domain })
    const path = `/user/${BOT_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response
    let body
    let signature
    let digest
    let follow

    before(async () => {
      const { formatter } = app.locals
      const botId = formatter.format({ username: BOT_USERNAME })
      follow = await as2.import({
        type: 'Follow',
        actor: remoteId,
        id: nockFormat({ username, type: 'follow', num: 1, obj: botId, domain }),
        object: botId,
        to: botId,
        cc: [
          'as:Public',
          nockFormat({ username, collection: 'followers', domain })
        ]
      })
      body = await follow.write()
      digest = makeDigest(body)
      signature = await nockSignature({
        method: 'POST',
        username,
        url,
        digest,
        date,
        domain
      })
      await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      await app.onIdle()
      const undo = await as2.import({
        type: 'Undo',
        actor: remoteId,
        id: nockFormat({ username, type: 'undo', num: 1, obj: follow.id, domain }),
        object: {
          type: 'Follow',
          id: follow.id,
          object: botId,
          to: botId,
          cc: [
            'as:Public',
            nockFormat({ username, collection: 'followers', domain })
          ]
        },
        to: botId,
        cc: [
          'as:Public',
          nockFormat({ username, collection: 'followers', domain })
        ]
      })
      body = await undo.write()
      digest = makeDigest(body)
      signature = await nockSignature({
        method: 'POST',
        username,
        url,
        digest,
        date,
        domain
      })
    })

    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })

    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202, JSON.stringify(response.body))
    })

    it('should deliver the reciprocal undo follow to the other actor', async () => {
      assert.strictEqual(postInbox[username], 4)
    })

    it('should have the reciprocal undo follow in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      let foundActivity
      for await (const item of actorStorage.items(BOT_USERNAME, 'outbox')) {
        const obj = await objectStorage.read(item.id)
        if (obj.type === UNDO_TYPE &&
          obj.object?.first?.object?.first?.id === remoteId) {
          foundActivity = obj
          break
        }
      }
      assert.ok(foundActivity)
    })
  })

  describe('reconciles missing follows on initialize', async () => {
    const driftUsername = 'reconciledrift'
    const existingUsername = 'reconcileexisting'
    const pendingUsername = 'reconcilepending'
    const driftId = nockFormat({ username: driftUsername, domain: REMOTE_HOST })
    const existingId = nockFormat({ username: existingUsername, domain: REMOTE_HOST })
    const pendingId = nockFormat({ username: pendingUsername, domain: REMOTE_HOST })

    let driftCountBefore
    let existingCountBefore
    let pendingCountBefore

    before(async () => {
      const { actorStorage, objectStorage, formatter } = app.locals

      driftCountBefore = postInbox[driftUsername] ?? 0
      existingCountBefore = postInbox[existingUsername] ?? 0
      pendingCountBefore = postInbox[pendingUsername] ?? 0

      // Drift: in followers only — should be followed on init
      await actorStorage.addToCollection(BOT_USERNAME, 'followers', { id: driftId })

      // Existing: in followers AND following — should NOT be re-followed
      await actorStorage.addToCollection(BOT_USERNAME, 'followers', { id: existingId })
      await actorStorage.addToCollection(BOT_USERNAME, 'following', { id: existingId })

      // Pending: in followers, has a pending Follow — should NOT be re-followed
      await actorStorage.addToCollection(BOT_USERNAME, 'followers', { id: pendingId })
      const botId = formatter.format({ username: BOT_USERNAME })
      const pendingFollow = await as2.import({
        type: 'Follow',
        id: `${botId}/follow/reconcilepending`,
        actor: botId,
        object: pendingId,
        to: pendingId
      })
      await objectStorage.create(pendingFollow)
      await actorStorage.setLastActivity(BOT_USERNAME, pendingFollow)
      await actorStorage.addToCollection(BOT_USERNAME, 'pendingFollowing', pendingFollow)

      // Re-trigger initialize to run reconciliation against seeded state
      const bot = app.locals.bots[BOT_USERNAME]
      await bot.initialize(bot._context)
      await app.onIdle()
    })

    it('should send a Follow to a follower not in following or pending', async () => {
      assert.ok(
        (postInbox[driftUsername] ?? 0) > driftCountBefore,
        `expected postInbox[${driftUsername}] to increase from ${driftCountBefore}, got ${postInbox[driftUsername]}`
      )
    })

    it('should NOT send a Follow to a follower already in following', async () => {
      assert.strictEqual(postInbox[existingUsername] ?? 0, existingCountBefore)
    })

    it('should NOT send a Follow to a follower with a pending Follow', async () => {
      assert.strictEqual(postInbox[pendingUsername] ?? 0, pendingCountBefore)
    })
  })

  describe('abandons stale pending Follows on initialize', async () => {
    const staleUsername = 'reconcilestale'
    const staleId = nockFormat({ username: staleUsername, domain: REMOTE_HOST })
    const staleFollowId = `__set_in_before__`
    let stalePendingFollow
    let staleCountBefore

    before(async () => {
      const { actorStorage, objectStorage, formatter } = app.locals
      staleCountBefore = postInbox[staleUsername] ?? 0

      // In followers, has a Follow in pendingFollowing whose published is > 7 days ago
      await actorStorage.addToCollection(BOT_USERNAME, 'followers', { id: staleId })
      const botId = formatter.format({ username: BOT_USERNAME })
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      stalePendingFollow = await as2.import({
        type: 'Follow',
        id: `${botId}/follow/reconcilestale`,
        actor: botId,
        object: staleId,
        to: staleId,
        published: eightDaysAgo
      })
      await objectStorage.create(stalePendingFollow)
      await actorStorage.setLastActivity(BOT_USERNAME, stalePendingFollow)
      await actorStorage.addToCollection(BOT_USERNAME, 'pendingFollowing', stalePendingFollow)

      // Re-trigger initialize to run the stale sweep + synchronize
      const bot = app.locals.bots[BOT_USERNAME]
      await bot.initialize(bot._context)
      await app.onIdle()
    })

    it('should deliver activities to the stale follower (Undo + fresh Follow)', async () => {
      assert.ok(
        (postInbox[staleUsername] ?? 0) >= staleCountBefore + 2,
        `expected postInbox[${staleUsername}] to grow by at least 2 from ${staleCountBefore}, got ${postInbox[staleUsername]}`
      )
    })

    it('should have an Undo of the stale Follow in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      let foundUndo
      for await (const item of actorStorage.items(BOT_USERNAME, 'outbox')) {
        const obj = await objectStorage.read(item.id)
        if (obj.type === UNDO_TYPE &&
          obj.object?.first?.id === stalePendingFollow.id) {
          foundUndo = obj
          break
        }
      }
      assert.ok(foundUndo, 'expected an Undo of the stale Follow in the bot outbox')
    })

    it('should have a fresh Follow for the stale follower in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      let foundFreshFollow
      for await (const item of actorStorage.items(BOT_USERNAME, 'outbox')) {
        const obj = await objectStorage.read(item.id)
        if (obj.type === FOLLOW_TYPE &&
          obj.id !== stalePendingFollow.id &&
          obj.object?.first?.id === staleId) {
          foundFreshFollow = obj
          break
        }
      }
      assert.ok(foundFreshFollow, 'expected a fresh Follow (different id) for the stale follower')
    })

    it('should remove the stale Follow from pendingFollowing', async () => {
      const { actorStorage } = app.locals
      const stillPending = await actorStorage.isInCollection(
        BOT_USERNAME,
        'pendingFollowing',
        stalePendingFollow
      )
      assert.strictEqual(stillPending, false)
    })
  })
})
