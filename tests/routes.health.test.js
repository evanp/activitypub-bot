import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'

import { makeApp } from '../lib/app.js'

import { getTestDatabaseUrl } from './utils/db.js'

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('health check routes', async () => {
  const LOCAL_HOST = 'local.routes-health.test'
  const databaseUrl = getTestDatabaseUrl()
  const origin = `https://${LOCAL_HOST}`
  const testBots = {}
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
    app = null
  })

  describe('GET /livez', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/livez')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return plain text', async () => {
      assert.strictEqual(response.type, 'text/plain')
    })
    it('should return an OK flag', async () => {
      assert.strictEqual(response.text, 'OK')
    })
  })
  describe('GET /readyz', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/readyz')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return plain text', async () => {
      assert.strictEqual(response.type, 'text/plain')
    })
    it('should return an OK flag', async () => {
      assert.strictEqual(response.text, 'OK')
    })
  })

  it('Creates an X-Request-ID', async () => {
    const response = await request(app).get('/readyz')
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers['x-request-id'])
    assert.ok(response.headers['x-request-id'].match(UUID_REGEXP))
  })

  it('Passes through an X-Request-ID', async () => {
    const id = 'FB726EB1-F325-47E4-93A0-C28A2517DC2A'
    const response = await request(app).get('/readyz')
      .set('X-Request-ID', id)
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers['x-request-id'])
    assert.strictEqual(response.headers['x-request-id'], id)
    assert.ok(response.headers['x-request-id'].match(UUID_REGEXP))
  })

  it('Ignores a non-UUID X-Request-ID', async () => {
    const id = 'not a UUID'
    const response = await request(app).get('/readyz')
      .set('X-Request-ID', id)
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers['x-request-id'])
    assert.ok(response.headers['x-request-id'] !== id)
    assert.ok(response.headers['x-request-id'].match(UUID_REGEXP))
  })
})
