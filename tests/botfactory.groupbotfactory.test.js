import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'
import { nockSetup, nockSignature, nockFormat, postInbox } from '@evanp/activitypub-nock'

import as2 from '../lib/activitystreams.js'
import { makeApp } from '../lib/app.js'
import GroupBotFactory from '../lib/bots/groupfactory.js'

import { makeDigest } from './utils/digest.js'
import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const AS = 'https://www.w3.org/ns/activitystreams#'

describe('GroupBotFactory', async () => {
  const LOCAL_HOST = 'local.botfactory-group.test'
  const REMOTE_HOST = 'remote.botfactory-group.test'
  const GROUP_USERNAME = 'python'
  const REMOTE_POSTER = 'botgroupfactoryposter'
  const REMOTE_FOLLOWER = 'botgroupfactoryfollower'
  const TEST_USERNAMES = [GROUP_USERNAME]
  const host = LOCAL_HOST
  const origin = `https://${LOCAL_HOST}`
  const botActor = `${origin}/user/${GROUP_USERNAME}`
  const databaseUrl = getTestDatabaseUrl()
  const testBots = {
    '*': new GroupBotFactory()
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

  describe('canCreate', async () => {
    const factory = new GroupBotFactory()
    it('accepts lowercase alphanumeric usernames', async () => {
      assert.strictEqual(await factory.canCreate('python'), true)
      assert.strictEqual(await factory.canCreate('foo123'), true)
      assert.strictEqual(await factory.canCreate('a'), true)
    })
    it('rejects hyphenated, underscored, or punctuated usernames', async () => {
      assert.strictEqual(await factory.canCreate('foo-bar'), false)
      assert.strictEqual(await factory.canCreate('foo_bar'), false)
      assert.strictEqual(await factory.canCreate('foo.bar'), false)
    })
    it('rejects uppercase letters', async () => {
      assert.strictEqual(await factory.canCreate('Python'), false)
    })
    it('rejects the empty string', async () => {
      assert.strictEqual(await factory.canCreate(''), false)
    })
    it('rejects usernames longer than 64 chars', async () => {
      assert.strictEqual(await factory.canCreate('a'.repeat(65)), false)
    })
    it('accepts usernames exactly 64 chars', async () => {
      assert.strictEqual(await factory.canCreate('a'.repeat(64)), true)
    })
  })

  describe('lazy-creates an actor', async () => {
    let response = null
    it('serves an actor JSON for an unknown valid username', async () => {
      response = await request(app)
        .get(`/user/${GROUP_USERNAME}`)
        .set('Accept', 'application/activity+json')
      assert.strictEqual(response.status, 200)
    })
    it('actor has type Group', () => {
      assert.strictEqual(response.body.type, 'Group')
    })
    it('actor has preferredUsername matching the request', () => {
      assert.strictEqual(response.body.preferredUsername, GROUP_USERNAME)
    })
  })

  describe('Webfinger discovery for a lazy-created group', async () => {
    let response = null
    it('resolves the group', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${GROUP_USERNAME}@${LOCAL_HOST}`)}`
      )
      assert.strictEqual(response.status, 200)
    })
    it('links to the actor URL', () => {
      const self = response.body.links.find(l => l.rel === 'self')
      assert.ok(self)
      assert.strictEqual(self.href, botActor)
    })
  })

  describe('announces on mention through the factory', async () => {
    const username = REMOTE_POSTER
    const path = `/user/${GROUP_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const noteId = nockFormatDefault({ username, type: 'note', num: 1 })
    let body = null
    let digest = null
    let signature = null
    let response = null

    before(async () => {
      await app.locals.actorStorage.addToCollection(
        GROUP_USERNAME,
        'followers',
        { id: nockFormatDefault({ username: REMOTE_FOLLOWER }) }
      )
      const activity = await as2.import({
        type: 'Create',
        actor: nockFormatDefault({ username }),
        id: nockFormatDefault({ username, type: 'create', num: 1 }),
        object: {
          id: noteId,
          type: 'Note',
          content: `Hello, @<a href="${botActor}">${GROUP_USERNAME}</a>!`,
          to: botActor,
          cc: 'as:Public',
          attributedTo: nockFormatDefault({ username }),
          tag: [{
            type: 'Mention',
            href: botActor,
            name: `@${GROUP_USERNAME}@${host}`
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

    it('accepts the inbox POST', async () => {
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

    it('returns 202', () => {
      assert.strictEqual(response.status, 202, JSON.stringify(response.body))
    })

    it('Announces the Note from the lazy-created group', async () => {
      const { actorStorage, objectStorage } = app.locals
      const outbox = await actorStorage.getCollection(GROUP_USERNAME, 'outbox')
      assert.strictEqual(outbox.totalItems, 1)
      const page = await actorStorage.getCollectionPage(GROUP_USERNAME, 'outbox', 1)
      const items = Array.from(page.items)
      const announce = await objectStorage.read(items[0].id)
      assert.strictEqual(announce.type, `${AS}Announce`)
      const objects = Array.from(announce.object)
      assert.strictEqual(objects[0].id, noteId)
    })

    it('delivers the Announce to the follower', () => {
      assert.strictEqual(postInbox[REMOTE_FOLLOWER], 1)
    })
  })
})
