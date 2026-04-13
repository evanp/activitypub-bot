import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const EPSILON = 100

describe('RequestThrottler', async () => {
  const LOCAL_HOST = 'local.requestthrottler.test'
  const REMOTE_HOST = 'remote.requestthrottler.test'
  const THIRD_HOST = 'third.requestthrottler.test'
  const MASTODON_HOST = 'mastodon.requestthrottler.test'

  let logger
  let connection
  let RequestThrottler
  let throttler

  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, THIRD_HOST, MASTODON_HOST]
    })
  })

  after(async () => {
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, THIRD_HOST, MASTODON_HOST]
    })
    await connection.close()
  })

  it('can import correctly', async () => {
    RequestThrottler = (await import('../lib/requestthrottler.js')).RequestThrottler
    assert.ok(RequestThrottler)
    assert.strictEqual(typeof RequestThrottler, 'function')
  })

  it('can be constructed', async () => {
    assert.ok(RequestThrottler)
    throttler = new RequestThrottler(connection, logger)
    assert.ok(throttler)
  })

  it('goes quickly on first request', async () => {
    assert.ok(throttler)
    const startTime = new Date()
    await throttler.throttle(REMOTE_HOST)
    const endTime = new Date()
    assert.ok(endTime - startTime < EPSILON)
  })

  it('accepts headers for updating the limit', async () => {
    assert.ok(throttler)
    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 3)
    headers.set('x-ratelimit-reset', (new Date(Date.now() + 1000)).toISOString())
    await throttler.update(REMOTE_HOST, headers)
    assert.ok(true)
  })

  it('spaces out the next requests', async () => {
    assert.ok(throttler)
    const startTime = new Date()
    await throttler.throttle(REMOTE_HOST)
    await throttler.throttle(REMOTE_HOST)
    await throttler.throttle(REMOTE_HOST)
    await throttler.throttle(REMOTE_HOST)
    const endTime = new Date()
    assert.ok(endTime - startTime > 500)
    assert.ok(endTime - startTime < 2000)
  })

  it('accepts integer header for updating the limit', async () => {
    assert.ok(throttler)
    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 3)
    headers.set('x-ratelimit-reset', 1)
    await throttler.update(REMOTE_HOST, headers)
    assert.ok(true)
  })

  it('spaces out the next requests for integer', async () => {
    assert.ok(throttler)
    const startTime = new Date()
    await throttler.throttle(REMOTE_HOST)
    await throttler.throttle(REMOTE_HOST)
    await throttler.throttle(REMOTE_HOST)
    await throttler.throttle(REMOTE_HOST)
    const endTime = new Date()
    assert.ok(endTime - startTime > 500)
    assert.ok(endTime - startTime < 2000)
  })

  it('lets us peek at the rate limit values', async () => {
    assert.ok(throttler)
    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 300)
    headers.set('x-ratelimit-reset', 900)
    await throttler.update(THIRD_HOST, headers)
    const limits = await throttler.peek(THIRD_HOST)
    assert.ok(limits)
    assert.ok(Array.isArray(limits))
    assert.strictEqual(limits.length, 1)
    assert.strictEqual(typeof limits[0], 'object')
    assert.strictEqual(typeof limits[0].policy, 'string')
    assert.strictEqual(limits[0].policy, 'default')
    assert.strictEqual(typeof limits[0].remaining, 'number')
    assert.strictEqual(limits[0].remaining, 300)
    assert.strictEqual(typeof limits[0].reset, 'object')
    assert.ok(limits[0].reset instanceof Date)
    assert.ok(Math.abs((limits[0].reset - Date.now()) - 900000) < 5000)
  })

  it('guesses at Mastodon rate limits', async () => {
    assert.ok(throttler)
    const headers = new Headers()
    headers.set('server', 'Mastodon')
    await throttler.update(MASTODON_HOST, headers)
    let limits = await throttler.peek(MASTODON_HOST)
    assert.ok(limits)
    assert.ok(Array.isArray(limits))
    assert.ok(limits.length > 0)
    assert.strictEqual(typeof limits[0], 'object')
    assert.strictEqual(typeof limits[0].policy, 'string')
    assert.strictEqual(limits[0].policy, 'default')
    assert.strictEqual(typeof limits[0].remaining, 'number')
    assert.strictEqual(limits[0].remaining, 299)
    assert.strictEqual(typeof limits[0].reset, 'object')
    assert.ok(limits[0].reset instanceof Date)
    assert.ok(limits[0].reset - Date.now() <= 300000)

    await throttler.throttle(MASTODON_HOST)

    await throttler.update(MASTODON_HOST, headers)
    limits = await throttler.peek(MASTODON_HOST)

    assert.ok(limits)
    assert.ok(Array.isArray(limits))
    assert.ok(limits.length > 0)
    assert.strictEqual(typeof limits[0], 'object')
    assert.strictEqual(typeof limits[0].policy, 'string')
    assert.strictEqual(limits[0].policy, 'default')
    assert.strictEqual(typeof limits[0].remaining, 'number')
    assert.strictEqual(limits[0].remaining, 298)
    assert.strictEqual(typeof limits[0].reset, 'object')
    assert.ok(limits[0].reset instanceof Date)
    assert.ok(limits[0].reset - Date.now() <= 300000)
  })
})
