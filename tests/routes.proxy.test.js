import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'
import {
  nockSetup,
  nockFormat
} from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

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
      databaseUrl, origin, bots, logLevel, redisUrl: getTestRedisUrl()
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
    it('should have an Allow header with POST', async () => {
      assert.strictEqual(response.headers.allow, 'POST')
    })
    it('should have a CORS header restricting to the local origin', async () => {
      assert.strictEqual(response.headers['access-control-allow-origin'], origin)
    })
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
})
