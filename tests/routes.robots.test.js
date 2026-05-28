import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'
import { nockSetup, nockSignature } from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const EXPECTED_BODY = '# We are all bots here\nUser-agent: *\nDisallow:\n'

describe('GET /robots.txt', async () => {
  const LOCAL_HOST = 'local.routes-robots.test'
  const REMOTE_HOST = 'remote.routes-robots.test'
  const REMOTE_USERNAME = 'robotstxtsigner'
  const TEST_USERNAMES = []
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  const testBots = {}
  let app = null

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

  describe('unsigned request', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/robots.txt')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return plain text', async () => {
      assert.strictEqual(response.type, 'text/plain')
    })
    it('should return the permissive robots.txt body', async () => {
      assert.strictEqual(response.text, EXPECTED_BODY)
    })
  })

  describe('valid signed request', async () => {
    let response = null
    it('should work without an error', async () => {
      const date = new Date().toUTCString()
      const signature = await nockSignature({
        method: 'GET',
        username: REMOTE_USERNAME,
        domain: REMOTE_HOST,
        url: `${origin}/robots.txt`,
        date
      })
      response = await request(app)
        .get('/robots.txt')
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return plain text', async () => {
      assert.strictEqual(response.type, 'text/plain')
    })
    it('should return the permissive robots.txt body', async () => {
      assert.strictEqual(response.text, EXPECTED_BODY)
    })
  })

  describe('invalid signed request', async () => {
    let response = null
    it('should work without an error', async () => {
      const date = new Date().toUTCString()
      const garbage = `keyId="https://${REMOTE_HOST}/nonexistent/key",algorithm="rsa-sha256",headers="(request-target) host date",signature="not-a-real-signature"`
      response = await request(app)
        .get('/robots.txt')
        .set('Signature', garbage)
        .set('Date', date)
        .set('Host', host)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return plain text', async () => {
      assert.strictEqual(response.type, 'text/plain')
    })
    it('should return the permissive robots.txt body', async () => {
      assert.strictEqual(response.text, EXPECTED_BODY)
    })
  })
})
