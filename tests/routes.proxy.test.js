import { corsTests } from './utils/cors.js'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import request from 'supertest'
import nock from 'nock'
import {
  nockSetup,
  nockFormat
} from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASIC_BLOCKLIST = resolve(__dirname, 'fixtures', 'blocklist-basic.csv')
const BLOCKED_HOST = 'blocked-one.test'

describe('proxy for remote objects', async () => {
  const LOCAL_HOST = 'local.routes-proxy.test'
  const REMOTE_HOST = 'remote.routes-proxy.test'
  const origin = `https://${LOCAL_HOST}`
  const logLevel = 'silent'
  const bots = {}
  const databaseUrl = getTestDatabaseUrl()
  let app

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl, origin, bots, logLevel, redisUrl: getTestRedisUrl(), domainBlockFileName: BASIC_BLOCKLIST
    })
    await cleanupTestData(app.locals.connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    nockSetup(REMOTE_HOST)
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await app.cleanup()
  })

  corsTests(() => app, () => [
    { path: '/shared/proxy', method: 'POST', body: { id: `https://${REMOTE_HOST}/user/remote0` }, headers: ['content-type'] },
    { path: '/shared/proxy', method: 'POST', body: {}, status: 400, headers: ['content-type'] }
  ], { origin, restricted: true })

  describe('request an existing remote object', async () => {
    let response
    const username = 'remote0'
    const domain = REMOTE_HOST
    const id = nockFormat({ username, domain })
    it('should work without an error', async () => {
      response = await request(app).post('/shared/proxy').type('form').send({ id })
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, id)
    })
    it('should have a CORS header restricting to the local origin', async () => {
      assert.strictEqual(response.headers['access-control-allow-origin'], origin)
    })
  })

  describe('preflight request', async () => {
    let response
    it('should work without an error', async () => {
      response = await request(app).options('/shared/proxy')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should have an Access-Control-Allow-Methods header with POST', async () => {
      assert.strictEqual(response.headers['access-control-allow-methods'], 'POST')
    })
    it('should have an Allow header including POST', async () => {
      const methods = (response.headers.allow || '').split(/\s*,\s*/)
      assert.ok(methods.includes('POST'))
    })
    it('should have a CORS header restricting to the local origin', async () => {
      assert.strictEqual(response.headers['access-control-allow-origin'], origin)
    })
  })

  it('CORS does not authorize an unrelated browser origin on proxy preflight', async () => {
    const response = await request(app).options('/shared/proxy')
      .set('Origin', 'https://browser.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
    assert.strictEqual(response.headers['access-control-allow-origin'], origin)
  })

  it('CORS does not authorize an unrelated browser origin on proxy responses', async () => {
    const response = await request(app).post('/shared/proxy')
      .set('Origin', 'https://browser.example')
      .type('form').send({ id: `https://${REMOTE_HOST}/user/remote0` })
    assert.strictEqual(response.status, 200)
    assert.strictEqual(response.headers['access-control-allow-origin'], origin)
  })

  describe('request a non-existent remote object', async () => {
    let response
    const id = `https://${REMOTE_HOST}/does-not-exist`
    it('should work without an error', async () => {
      response = await request(app).post('/shared/proxy').type('form').send({ id })
    })
    it('should return 400 Bad Request', async () => {
      assert.strictEqual(response.status, 400)
    })
    it('should return problem details', async () => {
      assert.strictEqual(response.type, 'application/problem+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with the right status', async () => {
      assert.strictEqual(typeof response.body.status, 'number')
      assert.strictEqual(response.body.status, 400)
    })
    it('should return an object with the right title', async () => {
      assert.strictEqual(typeof response.body.title, 'string')
      assert.strictEqual(response.body.title, 'Bad Request')
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'about:blank')
    })
  })

  describe('request a remote object whose content is on a blocked domain', async () => {
    let response
    const id = `https://${REMOTE_HOST}/object/blocked-embed`
    before(() => {
      nock(`https://${REMOTE_HOST}`)
        .get('/object/blocked-embed')
        .reply(
          200,
          {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id,
            type: 'Announce',
            attributedTo: nockFormat({ username: 'remote0', domain: REMOTE_HOST }),
            object: `https://${BLOCKED_HOST}/notes/1`,
            to: 'as:Public'
          },
          { 'Content-Type': 'application/activity+json' }
        )
    })
    it('should work without an error', async () => {
      response = await request(app).post('/shared/proxy').type('form').send({ id })
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })
})
