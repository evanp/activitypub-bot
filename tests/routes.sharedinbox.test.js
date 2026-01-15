import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import as2 from '../lib/activitystreams.js'
import request from 'supertest'

import { makeApp } from '../lib/app.js'

import { nockSetup, nockSignature, nockFormat, makeActor, addFollower } from './utils/nock.js'
import { makeDigest } from './utils/digest.js'
import bots from './fixtures/bots.js'

describe('routes.sharedinbox', async () => {
  const host = 'activitypubbot.test'
  const remoteHost = 'social.example'
  const origin = `https://${host}`
  const databaseUrl = 'sqlite::memory:'
  let app = null
  let formatter = null
  let actorStorage = null

  before(async () => {
    nockSetup(remoteHost)
    app = await makeApp(databaseUrl, origin, bots, 'silent')
    formatter = app.locals.formatter
    actorStorage = app.locals.actorStorage
  })

  describe('can handle an directly addressed incoming activity', async () => {
    const username = 'actor1'
    const botName = 'test0'
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    before(async () => {
      activity = await as2.import({
        type: 'Activity',
        actor: nockFormat({ username }),
        id: nockFormat({ username, type: 'activity', num: 1 }),
        to: formatter.format({ username: botName })
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
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should appear in the inbox', async () => {
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

  describe('can handle an incoming followers-only activity', async () => {
    const username = 'actor2'
    const botNames = ['test1', 'test2']
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActor(username, remoteHost)
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        addFollower(username, botId, remoteHost)
        await actorStorage.addToCollection(botName, 'following', actor)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormat({ username, type: 'activity', num: 1 }),
        to: nockFormat({ username, collection: 'followers' })
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
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should appear in all inboxes', async () => {
      for (const botName of botNames) {
        assert.strictEqual(
          true,
          await actorStorage.isInCollection(
            botName,
            'inbox',
            activity
          )
        )
      }
    })
  })
})
