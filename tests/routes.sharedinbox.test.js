import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import as2 from '../lib/activitystreams.js'
import request from 'supertest'
import { getTestDatabaseUrl } from './utils/db.js'

import { makeApp } from '../lib/app.js'

import {
  nockSetup,
  nockSignature,
  nockFormat,
  makeActor,
  addFollower,
  addFollowing,
  addToCollection
} from '@evanp/activitypub-nock'
import { makeDigest } from './utils/digest.js'
import bots from './fixtures/bots.js'

describe('routes.sharedinbox', async () => {
  const host = 'activitypubbot.test'
  const remoteHost = 'social.example'
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null
  let formatter = null
  let actorStorage = null

  before(async () => {
    nockSetup(remoteHost)
    app = await makeApp(databaseUrl, origin, bots, 'silent')
    formatter = app.locals.formatter
    actorStorage = app.locals.actorStorage
  })

  describe('can handle an directly addressed activity', async () => {
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
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
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

  describe('can handle an followers-only activity', async () => {
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
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
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

  describe('can handle a public activity', async () => {
    const username = 'actor3'
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
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormat({ username, type: 'activity', num: 1 }),
        to: 'as:Public'
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
      assert.strictEqual(response.status, 202)
    })
    it('should appear in all inboxes', async () => {
      const lb = bots.logging
      assert.ok(lb.publics.has(activity.id))
    })
  })

  describe('can handle an activity to local followers collection', async () => {
    const username = 'actor4'
    const botNames = ['test3', 'test4', 'test5']
    const followedBot = 'test6'
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
      const followed = await as2.import({
        id: formatter.format({ username: followedBot })
      })
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        const bot = await as2.import({ id: botId })
        await actorStorage.addToCollection(followedBot, 'followers', bot)
        await actorStorage.addToCollection(botName, 'following', followed)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormat({ username, type: 'activity', num: 1 }),
        to: formatter.format({ username: followedBot, collection: 'followers' })
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
      assert.strictEqual(response.status, 202)
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

  describe('can handle an activity to local following collection', async () => {
    const username = 'actor5'
    const botNames = ['test7', 'test8']
    const followingBot = 'test9'
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
      const following = await as2.import({
        id: formatter.format({ username: followingBot })
      })
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        const bot = await as2.import({ id: botId })
        await actorStorage.addToCollection(followingBot, 'following', bot)
        await actorStorage.addToCollection(botName, 'followers', following)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormat({ username, type: 'activity', num: 1 }),
        to: formatter.format({
          username: followingBot,
          collection: 'following'
        })
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
      assert.strictEqual(response.status, 202)
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

  describe('can handle an activity to remote following collection', async () => {
    const username = 'actor6'
    const botNames = ['test10', 'test11', 'test12']
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
        addFollowing(username, botId, remoteHost)
        await actorStorage.addToCollection(botName, 'followers', actor)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormat({ username, type: 'activity', num: 1 }),
        to: nockFormat({ username, collection: 'following' })
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
      assert.strictEqual(response.status, 202)
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

  describe('can handle an activity to remote actor collection', async () => {
    const username = 'actor7'
    const botNames = ['test13', 'test14', 'test15']
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const collection = 1
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
        addToCollection(username, collection, botId, remoteHost)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormat({ username, type: 'activity', num: 1 }),
        to: nockFormat({ username, type: 'collection', num: collection })
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
      assert.strictEqual(response.status, 202)
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

  describe('rejects a non-activity', async () => {
    const username = 'actor8'
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let note
    let body
    let digest
    let signature
    before(async () => {
      note = await as2.import({
        type: 'Note',
        attributedTo: nockFormat({ username }),
        to: 'as:Public',
        id: nockFormat({ username, type: 'Note', num: 1 })
      })
      body = await note.write()
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
    it('should return a 400 status', async () => {
      assert.strictEqual(response.status, 400)
    })
  })
})
