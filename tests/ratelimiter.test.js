import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const EPSILON = 100

describe('RateLimiter', async () => {
  const LOCAL_HOST = 'local.ratelimiter.test'
  const REMOTE_HOST = 'remote.ratelimiter.test'

  let logger
  let connection
  let RateLimiter
  let limiter

  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
  })

  after(async () => {
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await connection.close()
  })

  it('can import correctly', async () => {
    RateLimiter = (await import('../lib/ratelimiter.js')).RateLimiter
    assert.ok(RateLimiter)
    assert.strictEqual(typeof RateLimiter, 'function')
  })

  it('can be constructed', async () => {
    assert.ok(RateLimiter)
    limiter = new RateLimiter(connection, logger)
    assert.ok(limiter)
  })

  it('goes quickly on first request', async () => {
    assert.ok(limiter)
    const startTime = new Date()
    await limiter.limit(REMOTE_HOST)
    const endTime = new Date()
    assert.ok(endTime - startTime < EPSILON)
  })

  it('accepts headers for updating the limit', async () => {
    assert.ok(limiter)
    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 3)
    headers.set('x-ratelimit-reset', (new Date(Date.now() + 1000)).toISOString())
    await limiter.update(REMOTE_HOST, headers)
    assert.ok(true)
  })

  it('spaces out the next requests', async () => {
    assert.ok(limiter)
    const startTime = new Date()
    await limiter.limit(REMOTE_HOST)
    await limiter.limit(REMOTE_HOST)
    await limiter.limit(REMOTE_HOST)
    await limiter.limit(REMOTE_HOST)
    const endTime = new Date()
    assert.ok(endTime - startTime > 500)
    assert.ok(endTime - startTime < 2000)
  })

  it('accepts integer header for updating the limit', async () => {
    assert.ok(limiter)
    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 3)
    headers.set('x-ratelimit-reset', 1)
    await limiter.update(REMOTE_HOST, headers)
    assert.ok(true)
  })

  it('spaces out the next requests for integer', async () => {
    assert.ok(limiter)
    const startTime = new Date()
    await limiter.limit(REMOTE_HOST)
    await limiter.limit(REMOTE_HOST)
    await limiter.limit(REMOTE_HOST)
    await limiter.limit(REMOTE_HOST)
    const endTime = new Date()
    assert.ok(endTime - startTime > 500)
    assert.ok(endTime - startTime < 2000)
  })
})
