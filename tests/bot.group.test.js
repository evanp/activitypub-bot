import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'
import { nockSetup, nockSignature, nockFormat, postInbox } from '@evanp/activitypub-nock'

import as2 from '../lib/activitystreams.js'
import { makeApp } from '../lib/app.js'
import GroupBot from '../lib/bots/group.js'

import { makeDigest } from './utils/digest.js'
import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const AS = 'https://www.w3.org/ns/activitystreams#'

describe('Group bot', async () => {
  const LOCAL_HOST = 'local.bot-group.test'
  const REMOTE_HOST = 'remote.bot-group.test'
  const BOT_USERNAME = 'botgrouptest'
  const REMOTE_POSTER = 'botgroupposter'
  const REMOTE_FOLLOWER = 'botgroupfollower'
  const TEST_USERNAMES = [BOT_USERNAME]
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const botActor = `${origin}/user/${BOT_USERNAME}`
  const databaseUrl = getTestDatabaseUrl()
  const testBots = {
    [BOT_USERNAME]: new GroupBot(BOT_USERNAME, {
      fullname: 'Group Test',
      description: 'A test group bot'
    })
  }
  let app = null

  function nockFormatDefault (params) {
    return nockFormat({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  function nockSignatureDefault (params) {
    return nockSignature({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  before(async () => {
    nockSetup(REMOTE_HOST)
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent', redisUrl: getTestRedisUrl()
    })
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await app.locals.actorStorage.addToCollection(
      BOT_USERNAME,
      'followers',
      { id: nockFormatDefault({ username: REMOTE_FOLLOWER }) }
    )
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await app.cleanup()
  })

  describe('actor JSON', async () => {
    let response = null
    it('should fetch the actor', async () => {
      response = await request(app)
        .get(`/user/${BOT_USERNAME}`)
        .set('Accept', 'application/activity+json')
      assert.strictEqual(response.status, 200)
    })
    it('should have type Group', () => {
      assert.strictEqual(response.body.type, 'Group')
    })
    it('should expose fullname from options', () => {
      assert.strictEqual(response.body.name, 'Group Test')
    })
    it('should expose description from options', () => {
      assert.strictEqual(response.body.summary, 'A test group bot')
    })
  })

  describe('announces an object when mentioned', async () => {
    const username = REMOTE_POSTER
    const path = `/user/${BOT_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const noteId = nockFormatDefault({ username, type: 'note', num: 1 })
    const activity = await as2.import({
      type: 'Create',
      actor: nockFormatDefault({ username }),
      id: nockFormatDefault({ username, type: 'create', num: 1 }),
      object: {
        id: noteId,
        type: 'Note',
        content: `Hello, @<a href="${botActor}">${BOT_USERNAME}</a>!`,
        to: botActor,
        cc: 'as:Public',
        attributedTo: nockFormatDefault({ username }),
        tag: [{
          type: 'Mention',
          href: botActor,
          name: `@${BOT_USERNAME}@${host}`
        }]
      },
      to: botActor,
      cc: 'as:Public'
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

    it('should accept the inbox POST', async () => {
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

    it('should return 202', async () => {
      assert.strictEqual(response.status, 202, JSON.stringify(response.body))
    })

    it('should put an Announce in the outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      const outbox = await actorStorage.getCollection(BOT_USERNAME, 'outbox')
      assert.strictEqual(outbox.totalItems, 1)
      const page = await actorStorage.getCollectionPage(BOT_USERNAME, 'outbox', 1)
      const items = Array.from(page.items)
      assert.strictEqual(items.length, 1)
      const announce = await objectStorage.read(items[0].id)
      assert.strictEqual(announce.type, `${AS}Announce`)
    })

    it('should announce the Note, not the Create', async () => {
      const { actorStorage, objectStorage } = app.locals
      const page = await actorStorage.getCollectionPage(BOT_USERNAME, 'outbox', 1)
      const items = Array.from(page.items)
      const announce = await objectStorage.read(items[0].id)
      const objects = Array.from(announce.object)
      assert.strictEqual(objects[0].id, noteId)
    })

    it('should deliver the Announce to the follower', async () => {
      assert.strictEqual(postInbox[REMOTE_FOLLOWER], 1)
    })
  })

  describe('does not re-Announce a previously seen object', async () => {
    const username = REMOTE_POSTER
    const path = `/user/${BOT_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let body = null
    let digest = null
    let signature = null
    let response = null

    before(async () => {
      const noteId = nockFormatDefault({ username, type: 'note', num: 1 })
      const activity = await as2.import({
        type: 'Create',
        actor: nockFormatDefault({ username }),
        id: nockFormatDefault({ username, type: 'create', num: 2 }),
        object: {
          id: noteId,
          type: 'Note',
          content: `Hello, @<a href="${botActor}">${BOT_USERNAME}</a>!`,
          to: botActor,
          cc: 'as:Public',
          attributedTo: nockFormatDefault({ username }),
          tag: [{
            type: 'Mention',
            href: botActor,
            name: `@${BOT_USERNAME}@${host}`
          }]
        },
        to: botActor,
        cc: 'as:Public'
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

    it('should accept the second inbox POST', async () => {
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

    it('should still have only one Announce in the outbox', async () => {
      const { actorStorage } = app.locals
      const outbox = await actorStorage.getCollection(BOT_USERNAME, 'outbox')
      assert.strictEqual(outbox.totalItems, 1)
    })

    it('should not deliver a second Announce to the follower', async () => {
      assert.strictEqual(postInbox[REMOTE_FOLLOWER], 1)
    })
  })
})
