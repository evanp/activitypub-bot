import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import as2 from '../lib/activitystreams.js'
import request from 'supertest'

import { makeApp } from '../lib/app.js'

import { nockSetup, nockSignature, nockFormat, postInbox } from '@evanp/activitypub-nock'
import { makeDigest } from './utils/digest.js'
import bots from './fixtures/bots.js'

async function asyncSome(array, asyncPredicate) {
  for (let i = 0; i < array.length; i++) {
    if (await asyncPredicate(array[i], i, array)) {
      return true;
    }
  }
  return false;
}

describe('OK bot', async () => {
  const host = 'activitypubbot.example'
  const origin = `https://${host}`
  const databaseUrl = 'sqlite::memory:'
  let app = null

  before(async () => {
    nockSetup('social.example')
    app = await makeApp(databaseUrl, origin, bots, 'silent')
  })

  describe('responds to a mention', async () => {
    const username = 'actor2'
    const path = '/user/ok/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const activity = await as2.import({
      type: 'Create',
      actor: nockFormat({ username }),
      id: nockFormat({ username, type: 'create', num: 1 }),
      object: {
        id: nockFormat({ username, type: 'note', num: 1 }),
        type: 'Note',
        source: 'Hello, @ok!',
        content: `Hello, @<a href="${origin}/user/ok">ok</a>!`,
        to: `${origin}/user/ok`,
        cc: 'as:Public',
        attributedTo: nockFormat({ username }),
        tag: [
          {
            type: 'Mention',
            href: `${origin}/user/ok`,
            name: `@ok@${host}`
          }
        ]
      },
      to: `${origin}/user/ok`,
      cc: 'as:Public'
    })
    const body = await activity.write()
    const digest = makeDigest(body)
    const signature = await nockSignature({
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
      assert.strictEqual(postInbox.actor2, 1)
    })
    let reply = null
    let note = null
    it('should have the reply in its outbox', async () => {
      const { actorStorage, objectStorage } = app.locals
      const outbox = await actorStorage.getCollection('ok', 'outbox')
      assert.strictEqual(outbox.totalItems, 1)
      const outboxPage = await actorStorage.getCollectionPage('ok', 'outbox', 1)
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
    const username = 'actor3'
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let activity
    let body
    let digest
    let signature
    let response
    let reply = null
    let note = null
    before(async () => {
      activity = await as2.import({
        type: 'Create',
        actor: nockFormat({ username }),
        id: nockFormat({ username, type: 'create', num: 1 }),
        object: {
          id: nockFormat({ username, type: 'note', num: 1 }),
          type: 'Note',
          source: 'Hello, @ok!',
          content: `Hello, @<a href="${origin}/user/ok">ok</a>!`,
          to: `${origin}/user/ok`,
          cc: 'as:Public',
          attributedTo: nockFormat({ username }),
          tag: [
            {
              type: 'Mention',
              href: `${origin}/user/ok`,
              name: `@ok@${host}`
            }
          ]
        },
        to: `${origin}/user/ok`,
        cc: 'as:Public'
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignature({
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
      const outbox = await actorStorage.getCollection('ok', 'outbox')
      assert.strictEqual(outbox.totalItems, 2)
      const outboxPage = await actorStorage.getCollectionPage('ok', 'outbox', 1)
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
