import { describe, it } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import bots from './fixtures/bots.js'

describe('webfinger routes', async () => {
  const databaseUrl = 'sqlite::memory:'
  const origin = 'https://activitypubbot.test'
  const app = await makeApp(databaseUrl, origin, bots, 'silent')
  describe('GET /.well-known/webfinger', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/.well-known/webfinger?resource=acct%3Aok%40activitypubbot.test')
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
      assert.strictEqual(response.body.subject, 'acct:ok@activitypubbot.test')
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
      assert.strictEqual(response.body.links[0].href, 'https://activitypubbot.test/user/ok')
    })
  })
})
