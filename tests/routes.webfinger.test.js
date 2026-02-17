import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import OKBot from '../lib/bots/ok.js'
import { getTestDatabaseUrl } from './utils/db.js'

describe('webfinger routes', async () => {
  const LOCAL_HOST = 'local.routes-webfinger.test'
  const WRONG_HOST = 'wrong.routes-webfinger.test'
  const BOT_USERNAME = 'routeswebfingertestbot'
  const DNE_USERNAME = 'routeswebfingertestdne'
  const databaseUrl = getTestDatabaseUrl()
  const origin = `https://${LOCAL_HOST}`
  const testBots = {
    [BOT_USERNAME]: new OKBot(BOT_USERNAME)
  }
  let app = null

  before(async () => {
    app = await makeApp(databaseUrl, origin, testBots, 'silent')
  })

  after(async () => {
    if (!app) {
      return
    }
    await app.cleanup()
    app = null
  })

  describe('GET /.well-known/webfinger', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${BOT_USERNAME}@${LOCAL_HOST}`)}`
      )
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return JRD', async () => {
      assert.strictEqual(response.type, 'application/jrd+json')
    })
    it('should return an object with a subject', async () => {
      assert.strictEqual(typeof response.body.subject, 'string')
    })
    it('should return an object with an subject matching the request', async () => {
      assert.strictEqual(response.body.subject, `acct:${BOT_USERNAME}@${LOCAL_HOST}`)
    })
    it('should return an object with a links array', async () => {
      assert.strictEqual(Array.isArray(response.body.links), true)
    })
    it('should return an object with a links array containing the actor id', async () => {
      assert.strictEqual(response.body.links.length, 1)
      assert.strictEqual(typeof response.body.links[0].rel, 'string')
      assert.strictEqual(response.body.links[0].rel, 'self')
      assert.strictEqual(typeof response.body.links[0].type, 'string')
      assert.strictEqual(response.body.links[0].type, 'application/activity+json')
      assert.strictEqual(typeof response.body.links[0].href, 'string')
      assert.strictEqual(response.body.links[0].href, `${origin}/user/${BOT_USERNAME}`)
    })
  })
  describe('Webfinger discovery for non-existent user', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${DNE_USERNAME}@${LOCAL_HOST}`)}`
      )
    })
    it('should return 404 Not Found', async () => {
      assert.strictEqual(response.status, 404)
    })
  })
  describe('Webfinger discovery for wrong domain', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${DNE_USERNAME}@${WRONG_HOST}`)}`
      )
    })
    it('should return 400 Bad Request', async () => {
      assert.strictEqual(response.status, 400)
    })
  })
  describe('Webfinger discovery for HTTPS', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(`${origin}/user/${BOT_USERNAME}`)}`
      )
    })
    it('should return 400 Bad Request', async () => {
      assert.strictEqual(response.status, 400)
    })
  })
})
