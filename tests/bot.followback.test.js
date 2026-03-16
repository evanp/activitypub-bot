import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import request from 'supertest'
import { makeApp } from '../lib/app.js'
import { nockSetup, nockFormat, nockSignature, postInbox } from '@evanp/activitypub-nock'
import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'
import as2 from '../lib/activitystreams.js'
import { makeDigest } from './utils/digest.js'

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
    if (app) {
      await cleanupTestData(app.locals.connection, {
        usernames: TEST_USERNAMES,
        localDomain: LOCAL_HOST,
        remoteDomains: [REMOTE_HOST]
      })
      await app.cleanup()
    }
    app = null
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
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent'
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
})
