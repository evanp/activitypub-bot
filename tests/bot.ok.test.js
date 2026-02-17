import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import as2 from '../lib/activitystreams.js'
import request from 'supertest'
import { makeApp } from '../lib/app.js'
import OKBot from '../lib/bots/ok.js'
import { nockSetup, nockSignature, nockFormat, postInbox } from '@evanp/activitypub-nock'
import { makeDigest } from './utils/digest.js'
import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'

async function asyncSome (array, asyncPredicate) {
  for (let i = 0; i < array.length; i++) {
    if (await asyncPredicate(array[i], i, array)) {
      return true
    }
  }
  return false
}

describe('OK bot', async () => {
  const LOCAL_HOST = 'local.bot-ok.test'
  const REMOTE_HOST = 'remote.bot-ok.test'
  const BOT_USERNAME = 'botoktest'
  const REMOTE_ACTOR_DIRECT = 'botoktestactor1'
  const REMOTE_ACTOR_SHARED = 'botoktestactor2'
  const TEST_USERNAMES = [BOT_USERNAME]
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  const testBots = {
    [BOT_USERNAME]: new OKBot(BOT_USERNAME)
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
    app = await makeApp(databaseUrl, origin, testBots, 'silent')
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

  describe('responds to a mention', async () => {
    const username = REMOTE_ACTOR_DIRECT
    const path = `/user/${BOT_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const activity = await as2.import({
      type: 'Create',
      actor: nockFormatDefault({ username }),
      id: nockFormatDefault({ username, type: 'create', num: 1 }),
      object: {
        id: nockFormatDefault({ username, type: 'note', num: 1 }),
        type: 'Note',
        source: `Hello, @${BOT_USERNAME}!`,
        content: `Hello, @<a href="${origin}/user/${BOT_USERNAME}">${BOT_USERNAME}</a>!`,
        to: `${origin}/user/${BOT_USERNAME}`,
        cc: 'as:Public',
        attributedTo: nockFormatDefault({ username }),
        tag: [
          {
            type: 'Mention',
            href: `${origin}/user/${BOT_USERNAME}`,
            name: `@${BOT_USERNAME}@${host}`
          }
        ]
      },
      to: `${origin}/user/${BOT_USERNAME}`,
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

    it('should deliver the reply to the mentioned actor', async () => {
      assert.strictEqual(postInbox[username], 1)
    })

    it('should have the reply in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      const outbox = await actorStorage.getCollection(BOT_USERNAME, 'outbox')
      assert.strictEqual(outbox.totalItems, 1)
      const outboxPage = await actorStorage.getCollectionPage(BOT_USERNAME, 'outbox', 1)
      assert.strictEqual(outboxPage.items.length, 1)
      const arry = Array.from(outboxPage.items)
      assert.ok(await asyncSome(arry, async item => {
        const act = await objectStorage.read(item.id)
        const objects = Array.from(act.object)
        const note = await objectStorage.read(objects[0].id)
        return Array.from(note.inReplyTo)[0].id === Array.from(activity.object)[0].id
      }))
    })
  })

  describe('responds to a mention in public inbox', async () => {
    const username = REMOTE_ACTOR_SHARED
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let activity = null
    let body = null
    let digest = null
    let signature = null
    let response = null

    before(async () => {
      activity = await as2.import({
        type: 'Create',
        actor: nockFormatDefault({ username }),
        id: nockFormatDefault({ username, type: 'create', num: 1 }),
        object: {
          id: nockFormatDefault({ username, type: 'note', num: 1 }),
          type: 'Note',
          source: `Hello, @${BOT_USERNAME}!`,
          content: `Hello, @<a href="${origin}/user/${BOT_USERNAME}">${BOT_USERNAME}</a>!`,
          to: `${origin}/user/${BOT_USERNAME}`,
          cc: 'as:Public',
          attributedTo: nockFormatDefault({ username }),
          tag: [
            {
              type: 'Mention',
              href: `${origin}/user/${BOT_USERNAME}`,
              name: `@${BOT_USERNAME}@${host}`
            }
          ]
        },
        to: `${origin}/user/${BOT_USERNAME}`,
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

    it('should deliver the reply to the mentioned actor', async () => {
      assert.strictEqual(postInbox[username], 1)
    })

    it('should have the reply in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      const outbox = await actorStorage.getCollection(BOT_USERNAME, 'outbox')
      assert.strictEqual(outbox.totalItems, 2)
      const outboxPage = await actorStorage.getCollectionPage(BOT_USERNAME, 'outbox', 1)
      assert.strictEqual(outboxPage.items.length, 2)
      const arry = Array.from(outboxPage.items)
      assert.ok(await asyncSome(arry, async item => {
        const act = await objectStorage.read(item.id)
        const objects = Array.from(act.object)
        const note = await objectStorage.read(objects[0].id)
        return Array.from(note.inReplyTo)[0].id === Array.from(activity.object)[0].id
      }))
    })
  })
})
