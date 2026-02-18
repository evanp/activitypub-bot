import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import as2 from '../lib/activitystreams.js'
import request from 'supertest'
import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'
import { nockSetup, nockSignature, nockFormat } from '@evanp/activitypub-nock'
import { makeDigest } from './utils/digest.js'
import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'
import EventLoggingBot from './fixtures/eventloggingbot.js'

describe('routes.inbox', async () => {
  const LOCAL_HOST = 'local.routes-inbox.test'
  const REMOTE_HOST = 'remote.routes-inbox.test'
  const BOT_USERNAME = 'routesinboxtestreadonly'
  const INBOX_BOT_1 = 'routesinboxtest1'
  const INBOX_BOT_2 = 'routesinboxtest2'
  const INBOX_BOT_3 = 'routesinboxtest3'
  const INBOX_BOT_4 = 'routesinboxtest4'
  const INBOX_BOT_5 = 'routesinboxtest5'
  const LOGGING_BOT = 'routesinboxtestlogging1'
  const REMOTE_ACTOR_1 = 'routesinboxtestactor1'
  const REMOTE_ACTOR_2 = 'routesinboxtestactor2'
  const REMOTE_ACTOR_3 = 'routesinboxtestactor3'
  const REMOTE_ACTOR_4 = 'routesinboxtestactor4'
  const TEST_USERNAMES = [BOT_USERNAME, INBOX_BOT_1, INBOX_BOT_2, INBOX_BOT_3, INBOX_BOT_4, INBOX_BOT_5, LOGGING_BOT]
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  const lb = new EventLoggingBot(LOGGING_BOT)
  const testBots = {
    [BOT_USERNAME]: new DoNothingBot(BOT_USERNAME),
    [INBOX_BOT_1]: new DoNothingBot(INBOX_BOT_1),
    [INBOX_BOT_2]: new DoNothingBot(INBOX_BOT_2),
    [INBOX_BOT_3]: new DoNothingBot(INBOX_BOT_3),
    [INBOX_BOT_4]: new DoNothingBot(INBOX_BOT_4),
    [INBOX_BOT_5]: new DoNothingBot(INBOX_BOT_5),
    [LOGGING_BOT]: lb
  }

  function nockFormatDefault (params) {
    return nockFormat({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  function nockSignatureDefault (params) {
    return nockSignature({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  let app = null

  before(async () => {
    nockSetup(REMOTE_HOST)
    app = await makeApp(databaseUrl, origin, testBots, 'debug')
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
  })

  after(async () => {
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await app.cleanup()
    app = null
  })

  describe('GET /user/{botid}/inbox', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${BOT_USERNAME}/inbox`)
    })
    it('should return 403 Forbidden', async () => {
      assert.strictEqual(response.status, 403)
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
      assert.strictEqual(response.body.title, 'Forbidden')
    })
    it('should return an object with a status', async () => {
      assert.strictEqual(typeof response.body.status, 'number')
    })
    it('should return an object with a status matching the request', async () => {
      assert.strictEqual(response.body.status, 403)
    })
    it('should return an object with a detail', async () => {
      assert.strictEqual(typeof response.body.detail, 'string')
    })
    it('should return an object with a detail matching the request', async () => {
      assert.strictEqual(response.body.detail, 'No access to inbox collection')
    })
  })

  describe('GET /user/{botid}/inbox/1', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${BOT_USERNAME}/inbox/1`)
    })
    it('should return 403 Forbidden', async () => {
      assert.strictEqual(response.status, 403)
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
      assert.strictEqual(response.body.title, 'Forbidden')
    })
    it('should return an object with a status', async () => {
      assert.strictEqual(typeof response.body.status, 'number')
    })
    it('should return an object with a status matching the request', async () => {
      assert.strictEqual(response.body.status, 403)
    })
    it('should return an object with a detail', async () => {
      assert.strictEqual(typeof response.body.detail, 'string')
    })
    it('should return an object with a detail matching the request', async () => {
      assert.strictEqual(response.body.detail, 'No access to inbox collection')
    })
  })

  describe('can handle an incoming activity', async () => {
    const username = REMOTE_ACTOR_1
    const botName = INBOX_BOT_1
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const activity = await as2.import({
      type: 'Activity',
      actor: nockFormatDefault({ username }),
      id: nockFormatDefault({ username, type: 'activity', num: 1 })
    })
    const body = await activity.write()
    const digest = makeDigest(body)
    const signature = await nockSignatureDefault({
      method: 'POST',
      username,
      url,
      digest,
      date
    })
    let response = null
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
      assert.strictEqual(response.status, 202)
    })
    it('should appear in the inbox', async () => {
      const { actorStorage } = app.locals
      assert.strictEqual(
        true,
        await actorStorage.isInCollection(
          botName,
          'inbox',
          activity
        )
      )
    })
  })

  describe('can handle a duplicate incoming activity', async () => {
    const username = REMOTE_ACTOR_2
    const botName = INBOX_BOT_2
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const activity = await as2.import({
      type: 'Activity',
      actor: nockFormatDefault({ username }),
      id: nockFormatDefault({ username, type: 'activity', num: 2 }),
      to: 'as:Public'
    })
    const body = await activity.write()
    const digest = makeDigest(body)
    const signature = await nockSignatureDefault({
      method: 'POST',
      username,
      url,
      digest,
      date
    })
    let response = null
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
      assert.strictEqual(response.status, 202)
    })
    it('should appear in the inbox', async () => {
      const { actorStorage } = app.locals
      assert.strictEqual(
        true,
        await actorStorage.isInCollection(
          botName,
          'inbox',
          activity
        )
      )
    })
    it('should fail the second time', async () => {
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
    it('should return a 400 status', async () => {
      assert.strictEqual(response.status, 400)
    })
  })

  describe('rejects a non-activity', async () => {
    const username = REMOTE_ACTOR_3
    const botName = INBOX_BOT_3
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const note = await as2.import({
      type: 'Note',
      attributedTo: nockFormatDefault({ username }),
      to: 'as:Public',
      id: nockFormatDefault({ username, type: 'Note', num: 1 })
    })
    const body = await note.write()
    const digest = makeDigest(body)
    const signature = await nockSignatureDefault({
      method: 'POST',
      username,
      url,
      digest,
      date
    })
    let response = null
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
    it('should return a 400 status', async () => {
      assert.strictEqual(response.status, 400)
    })
    it('should not appear in the inbox', async () => {
      const { actorStorage } = app.locals
      assert.strictEqual(
        false,
        await actorStorage.isInCollection(
          botName,
          'inbox',
          note
        )
      )
    })
  })

  describe('delivers an incoming public activity', async () => {
    const username = REMOTE_ACTOR_4
    const botName = INBOX_BOT_4
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let activity
    let body
    let digest
    let signature
    before(async () => {
      const formatter = app.locals.formatter
      activity = await as2.import({
        type: 'Activity',
        actor: nockFormatDefault({ username }),
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: ['as:Public', formatter.format({ username }), formatter.format({ username: INBOX_BOT_5 })]
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
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
      assert.strictEqual(response.status, 202)
    })
    it('should be delivered to onPublic()', async () => {
      assert.ok(lb.publics.has(activity.id))
    })
    it('should deliver to another inbox', async () => {
      const path = `/user/${INBOX_BOT_5}/inbox`
      const url = `${origin}${path}`
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
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
    it('should also return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should not be delivered to onPublic() a second time', async () => {
      assert.ok(!lb.dupes.has(activity.id))
    })
  })
})
