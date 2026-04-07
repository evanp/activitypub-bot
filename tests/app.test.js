import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'

import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'

import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('app', async () => {
  const LOCAL_HOST = 'local.app.test'
  const origin = `https://${LOCAL_HOST}`
  const BOT_USERNAME = 'apptestbot1'
  const TEST_USERNAMES = [BOT_USERNAME]
  const testBots = {
    [BOT_USERNAME]: new DoNothingBot(BOT_USERNAME)
  }
  const databaseUrl = getTestDatabaseUrl()
  let app = null

  before(async () => {
    app = await makeApp({
      databaseUrl,
      origin,
      bots: testBots,
      logLevel: 'silent'
    })
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
  })

  after(async () => {
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
    await app.cleanup()
    app = null
  })

  it('should be a function', async () => {
    assert.strictEqual(typeof makeApp, 'function')
  })
  it('should return a function', async () => {
    assert.strictEqual(typeof app, 'function')
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

  it('Does not include X-Powered-By header', async () => {
    const response = await request(app).get('/readyz')
    assert.strictEqual(response.status, 200)
    assert.ok(!response.headers['x-powered-by'])
  })
})
