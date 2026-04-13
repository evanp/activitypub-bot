import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'

import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

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
  const redisUrl = getTestRedisUrl()
  let app = null

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl,
      origin,
      bots: testBots,
      logLevel: 'silent',
      redisUrl
    })
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
    await app.cleanup()
  })

  it('should be a function', async () => {
    assert.strictEqual(typeof makeApp, 'function')
  })
  it('should return a function', async () => {
    assert.strictEqual(typeof app, 'function')
  })
  it('should not allow private network requests by default', async () => {
    assert.strictEqual(app.locals.client.allowPrivateNetworkRequests, false)
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

  it('includes RateLimit headers on GET responses', async () => {
    const response = await request(app).get('/readyz')
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers.ratelimit)
    assert.ok(response.headers['ratelimit-policy'])
  })

  it('includes RateLimit headers on POST responses', async () => {
    const response = await request(app)
      .post(`/user/${BOT_USERNAME}/inbox`)
      .set('Content-Type', 'application/activity+json')
      .send({})
    // We expect a 4xx (no signature, etc.) but headers should still be present
    assert.ok(response.headers.ratelimit)
    assert.ok(response.headers['ratelimit-policy'])
  })

  it('returns 429 when GET burst rate limit is exceeded', async () => {
    const burstLimit = 1000
    const requests = Array.from(
      { length: burstLimit + 1 },
      () => request(app).get('/readyz')
    )
    const responses = await Promise.all(requests)
    const rateLimited = responses.filter(r => r.status === 429)
    assert.ok(rateLimited.length > 0, 'Expected at least one 429 response')
    const limited = rateLimited[0]
    assert.strictEqual(limited.headers['content-type'], 'application/problem+json; charset=utf-8')
    assert.strictEqual(limited.body.status, 429)
    assert.strictEqual(limited.body.type, 'about:blank')
    assert.ok(limited.body.title)
    assert.ok(limited.body.detail)
    assert.ok(limited.headers['retry-after'])
  })

  it('allows private network requests when the override is set', async () => {
    const overrideHost = 'private-network-override.app.test'
    const overrideOrigin = `https://${overrideHost}`
    const overrideUsername = 'apptestbot2'
    const overrideApp = await makeApp({
      databaseUrl,
      origin: overrideOrigin,
      bots: {
        [overrideUsername]: new DoNothingBot(overrideUsername)
      },
      logLevel: 'silent',
      allowPrivateNetworkRequests: true,
      redisUrl
    })
    try {
      await cleanupTestData(overrideApp.locals.connection, {
        usernames: [overrideUsername],
        localDomain: overrideHost
      })
      assert.strictEqual(overrideApp.locals.client.allowPrivateNetworkRequests, true)
    } finally {
      await cleanupTestData(overrideApp.locals.connection, {
        usernames: [overrideUsername],
        localDomain: overrideHost
      })
      await overrideApp.cleanup()
    }
  })
})
