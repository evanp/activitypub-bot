import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import as2 from '../lib/activitystreams.js'
import request from 'supertest'
import { getTestDatabaseUrl } from './utils/db.js'

import { makeApp } from '../lib/app.js'

import { nockSetup, nockSignature, nockFormat } from '@evanp/activitypub-nock'
import { makeDigest } from './utils/digest.js'
import bots from './fixtures/bots.js'

describe('routes.inbox', async () => {
  const host = 'activitypubbot.test'
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null

  before(async () => {
    nockSetup('social.example')
    app = await makeApp(databaseUrl, origin, bots, 'silent')
  })

  describe('GET /user/{botid}/inbox', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/ok/inbox')
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
      response = await request(app).get('/user/ok/inbox/1')
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
    const username = 'actor1'
    const botName = 'test0'
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const activity = await as2.import({
      type: 'Activity',
      actor: nockFormat({ username }),
      id: nockFormat({ username, type: 'activity', num: 1 })
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
    const username = 'actor2'
    const botName = 'test1'
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const activity = await as2.import({
      type: 'Activity',
      actor: nockFormat({ username }),
      id: nockFormat({ username, type: 'activity', num: 2 }),
      to: 'as:Public'
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
    const username = 'actor3'
    const botName = 'test2'
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const note = await as2.import({
      type: 'Note',
      attributedTo: nockFormat({ username }),
      to: 'as:Public',
      id: nockFormat({ username, type: 'Note', num: 1 })
    })
    const body = await note.write()
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
})
