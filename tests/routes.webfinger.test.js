import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'

import { makeApp } from '../lib/app.js'
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
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent'
    })
  })

  after(async () => {
    if (!app) {
      return
    }
    await app.cleanup()
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
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[0].rel, 'string')
      assert.strictEqual(response.body.links[0].rel, 'self')
      assert.strictEqual(typeof response.body.links[0].type, 'string')
      assert.strictEqual(response.body.links[0].type, 'application/activity+json')
      assert.strictEqual(typeof response.body.links[0].href, 'string')
      assert.strictEqual(response.body.links[0].href, `${origin}/user/${BOT_USERNAME}`)
    })
    it('should return an object with a links array containing the profile page', async () => {
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[1].rel, 'string')
      assert.strictEqual(response.body.links[1].rel, 'http://webfinger.net/rel/profile-page')
      assert.strictEqual(typeof response.body.links[1].type, 'string')
      assert.strictEqual(response.body.links[1].type, 'text/html')
      assert.strictEqual(typeof response.body.links[1].href, 'string')
      assert.strictEqual(response.body.links[1].href, `${origin}/profile/${BOT_USERNAME}`)
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
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200, response.body)
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
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[0].rel, 'string')
      assert.strictEqual(response.body.links[0].rel, 'self')
      assert.strictEqual(typeof response.body.links[0].type, 'string')
      assert.strictEqual(response.body.links[0].type, 'application/activity+json')
      assert.strictEqual(typeof response.body.links[0].href, 'string')
      assert.strictEqual(response.body.links[0].href, `${origin}/user/${BOT_USERNAME}`)
    })
    it('should return an object with a links array containing the profile page', async () => {
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[1].rel, 'string')
      assert.strictEqual(response.body.links[1].rel, 'http://webfinger.net/rel/profile-page')
      assert.strictEqual(typeof response.body.links[1].type, 'string')
      assert.strictEqual(response.body.links[1].type, 'text/html')
      assert.strictEqual(typeof response.body.links[1].href, 'string')
      assert.strictEqual(response.body.links[1].href, `${origin}/profile/${BOT_USERNAME}`)
    })
  })
  describe('Webfinger discovery for server actor', async () => {
    let response = null
    const resource = `acct:${LOCAL_HOST}@${LOCAL_HOST}`

    it('should work without an error', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(resource)}`
      )
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200, response.body)
    })
    it('should return JRD', async () => {
      assert.strictEqual(response.type, 'application/jrd+json')
    })
    it('should return an object with a subject', async () => {
      assert.strictEqual(typeof response.body.subject, 'string')
    })
    it('should return an object with an subject matching the request', async () => {
      assert.strictEqual(response.body.subject, resource)
    })
    it('should return an object with a links array', async () => {
      assert.strictEqual(Array.isArray(response.body.links), true)
    })
    it('should return an object with a links array containing the actor id', async () => {
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[0].rel, 'string')
      assert.strictEqual(response.body.links[0].rel, 'self')
      assert.strictEqual(typeof response.body.links[0].type, 'string')
      assert.strictEqual(response.body.links[0].type, 'application/activity+json')
      assert.strictEqual(typeof response.body.links[0].href, 'string')
      assert.strictEqual(response.body.links[0].href, `${origin}/user/${LOCAL_HOST}`)
    })
    it('should return an object with a links array containing the profile page', async () => {
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[1].rel, 'string')
      assert.strictEqual(response.body.links[1].rel, 'http://webfinger.net/rel/profile-page')
      assert.strictEqual(typeof response.body.links[1].type, 'string')
      assert.strictEqual(response.body.links[1].type, 'text/html')
      assert.strictEqual(typeof response.body.links[1].href, 'string')
      assert.strictEqual(response.body.links[1].href, `${origin}/profile/${LOCAL_HOST}`)
    })
  })
  describe('Webfinger discovery for HTTPS profile page', async () => {
    let response = null
    const profileUrl = `${origin}/profile/${BOT_USERNAME}`

    it('should work without an error', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(profileUrl)}`
      )
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200, response.body)
    })
    it('should return JRD', async () => {
      assert.strictEqual(response.type, 'application/jrd+json')
    })
    it('should return the profile URL as subject', async () => {
      assert.strictEqual(response.body.subject, profileUrl)
    })
    it('should return a single alternate link to the actor', async () => {
      assert.strictEqual(response.body.links.length, 1)
      assert.strictEqual(response.body.links[0].rel, 'alternate')
      assert.strictEqual(response.body.links[0].type, 'application/activity+json')
      assert.strictEqual(response.body.links[0].href, `${origin}/user/${BOT_USERNAME}`)
    })
  })
  describe('Webfinger discovery for HTTPS server actor', async () => {
    let response = null
    const acct = `acct:${LOCAL_HOST}@${LOCAL_HOST}`
    const actorId = `${origin}/user/${LOCAL_HOST}`

    it('should work without an error', async () => {
      response = await request(app).get(
        `/.well-known/webfinger?resource=${encodeURIComponent(actorId)}`
      )
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200, response.body)
    })
    it('should return JRD', async () => {
      assert.strictEqual(response.type, 'application/jrd+json')
    })
    it('should return an object with a subject', async () => {
      assert.strictEqual(typeof response.body.subject, 'string')
    })
    it('should return an object with an subject matching the request', async () => {
      assert.strictEqual(response.body.subject, acct)
    })
    it('should return an object with a links array', async () => {
      assert.strictEqual(Array.isArray(response.body.links), true)
    })
    it('should return an object with a links array containing the actor id', async () => {
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[0].rel, 'string')
      assert.strictEqual(response.body.links[0].rel, 'self')
      assert.strictEqual(typeof response.body.links[0].type, 'string')
      assert.strictEqual(response.body.links[0].type, 'application/activity+json')
      assert.strictEqual(typeof response.body.links[0].href, 'string')
      assert.strictEqual(response.body.links[0].href, actorId)
    })
    it('should return an object with a links array containing the profile page', async () => {
      assert.strictEqual(response.body.links.length, 2)
      assert.strictEqual(typeof response.body.links[1].rel, 'string')
      assert.strictEqual(response.body.links[1].rel, 'http://webfinger.net/rel/profile-page')
      assert.strictEqual(typeof response.body.links[1].type, 'string')
      assert.strictEqual(response.body.links[1].type, 'text/html')
      assert.strictEqual(typeof response.body.links[1].href, 'string')
      assert.strictEqual(response.body.links[1].href, `${origin}/profile/${LOCAL_HOST}`)
    })
  })
})
