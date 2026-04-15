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
const ANNOUNCE_TYPE = `${AS}Announce`

describe('LitePubRelayServerBot', async () => {
  const LOCAL_HOST = 'local.bot-litepubrelayserver.test'
  const REMOTE_HOST = 'remote.bot-litepubrelayserver.test'
  const BOT_USERNAME = 'botlitepubrelayservertest'
  const REMOTE_ACTOR = 'botlitepubrelayserverremote'
  const REMOTE_ACTOR_2 = 'botlitepubrelayserverremote2'
  const REMOTE_ACTOR_3 = 'botlitepubrelayserverremote3'
  const REMOTE_ACTOR_4 = 'botlitepubrelayserverremote4'
  const TEST_USERNAMES = [BOT_USERNAME]

  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null
  let LitePubRelayServerBot

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
      LitePubRelayServerBot = (await import('../lib/bots/litepubrelayserver.js')).default
    } catch (err) {
      assert.fail(err.message)
    }
    assert.ok(LitePubRelayServerBot)
    assert.strictEqual(typeof LitePubRelayServerBot, 'function')
    const testBots = {}
    testBots[BOT_USERNAME] = new LitePubRelayServerBot(BOT_USERNAME)
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
        to: formatter.format({ username: BOT_USERNAME })
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
        to: botId
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
          actor: remoteId,
          object: botId,
          to: botId
        },
        to: botId
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

  describe('forwards an Announce from a follower to its other followers', async () => {
    const senderUsername = REMOTE_ACTOR_3
    const otherUsername = REMOTE_ACTOR_4
    const domain = REMOTE_HOST
    const senderId = nockFormat({ username: senderUsername, domain })
    const path = `/user/${BOT_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response
    let body
    let signature
    let digest
    let announcedId
    let otherPostsBefore

    async function sendFollow (username) {
      const { formatter } = app.locals
      const botId = formatter.format({ username: BOT_USERNAME })
      const follow = await as2.import({
        type: 'Follow',
        actor: nockFormat({ username, domain }),
        id: nockFormat({ username, type: 'follow', num: 1, obj: botId, domain }),
        object: botId,
        to: botId
      })
      const fBody = await follow.write()
      const fDigest = makeDigest(fBody)
      const fSig = await nockSignature({
        method: 'POST',
        username,
        url,
        digest: fDigest,
        date,
        domain
      })
      await request(app)
        .post(path)
        .send(fBody)
        .set('Signature', fSig)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', fDigest)
        .set('Content-Type', 'application/activity+json')
      await app.onIdle()
    }

    before(async () => {
      await sendFollow(senderUsername)
      await sendFollow(otherUsername)

      otherPostsBefore = postInbox[otherUsername] || 0

      announcedId = nockFormat({ username: senderUsername, type: 'note', num: 1, domain })

      const { formatter } = app.locals
      const announce = await as2.import({
        type: 'Announce',
        actor: senderId,
        id: nockFormat({ username: senderUsername, type: 'announce', num: 1, domain }),
        object: announcedId,
        to: [
          formatter.format({ username: BOT_USERNAME, collection: 'followers' })
        ],
        cc: ['as:Public']
      })
      body = await announce.write()
      digest = makeDigest(body)
      signature = await nockSignature({
        method: 'POST',
        username: senderUsername,
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

    it('should deliver an Announce to the other follower', async () => {
      assert.strictEqual(postInbox[otherUsername], otherPostsBefore + 1)
    })

    it('should have the re-Announce in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      let foundActivity
      for await (const item of actorStorage.items(BOT_USERNAME, 'outbox')) {
        const obj = await objectStorage.read(item.id)
        if (obj.type === ANNOUNCE_TYPE &&
          obj.object?.first?.id === announcedId) {
          foundActivity = obj
          break
        }
      }
      assert.ok(foundActivity)
    })
  })
})
