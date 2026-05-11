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
  const SHED_HOST = 'shed.requestthrottler.test'
  const RESET_OFFSET_HOST = 'reset-offset.requestthrottler.test'
  const RESET_EPOCH_HOST = 'reset-epoch.requestthrottler.test'

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
      remoteDomains: [REMOTE_HOST, THIRD_HOST, MASTODON_HOST, SHED_HOST, RESET_OFFSET_HOST, RESET_EPOCH_HOST]
    })
  })

  after(async () => {
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, THIRD_HOST, MASTODON_HOST, SHED_HOST, RESET_OFFSET_HOST, RESET_EPOCH_HOST]
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

  it('throws a ThrottleError when the wait would exceed the max wait time', async () => {
    assert.ok(throttler)
    const { ThrottleError } = await import('../lib/requestthrottler.js')
    assert.ok(ThrottleError, 'expected ThrottleError to be exported from requestthrottler.js')

    const RESET_MS = 60000
    const MAX_WAIT = 30000

    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 0)
    headers.set('x-ratelimit-reset', (new Date(Date.now() + RESET_MS)).toISOString())
    await throttler.update(SHED_HOST, headers)

    await assert.rejects(
      throttler.throttle(SHED_HOST, MAX_WAIT),
      err => {
        assert.ok(err instanceof ThrottleError, 'expected ThrottleError instance')
        assert.strictEqual(typeof err.waitTime, 'number', 'expected numeric waitTime')
        assert.ok(err.waitTime > MAX_WAIT, `expected waitTime > maxWaitTime, got ${err.waitTime}`)
        assert.ok(err.waitTime <= RESET_MS, `expected waitTime <= window, got ${err.waitTime}`)
        return true
      }
    )
  })

  it('treats numeric x-ratelimit-reset below 30 days (in seconds) as a relative offset', async () => {
    // Just under the 30-day boundary, in seconds.
    const offsetSeconds = 30 * 24 * 60 * 60 - 1 // 2,591,999
    const beforeUpdate = Date.now()
    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 100)
    headers.set('x-ratelimit-reset', String(offsetSeconds))
    await throttler.update(RESET_OFFSET_HOST, headers)

    const limits = await throttler.peek(RESET_OFFSET_HOST)
    assert.strictEqual(limits.length, 1)
    assert.ok(limits[0].reset instanceof Date)
    // reset should be ~offsetSeconds in the future from when we called update.
    const expected = beforeUpdate + offsetSeconds * 1000
    const drift = Math.abs(limits[0].reset.getTime() - expected)
    assert.ok(
      drift < 5000,
      `expected reset within 5s of now+${offsetSeconds}s, got drift=${drift}ms (reset=${limits[0].reset.toISOString()})`
    )
  })

  it('treats numeric x-ratelimit-reset at or above 30 days (in seconds) as Unix epoch seconds', async () => {
    // Plausible epoch-seconds value: current epoch + 60s. Well above the 30-day threshold.
    const targetMs = Date.now() + 60_000
    const epochSeconds = Math.floor(targetMs / 1000)
    const headers = new Headers()
    headers.set('x-ratelimit-limit', 1000)
    headers.set('x-ratelimit-remaining', 100)
    headers.set('x-ratelimit-reset', String(epochSeconds))
    await throttler.update(RESET_EPOCH_HOST, headers)

    const limits = await throttler.peek(RESET_EPOCH_HOST)
    assert.strictEqual(limits.length, 1)
    assert.ok(limits[0].reset instanceof Date)
    // reset should be ~targetMs, NOT now + epochSeconds*1000 (which would be ~56,000 years out).
    const drift = Math.abs(limits[0].reset.getTime() - targetMs)
    assert.ok(
      drift < 5000,
      `expected reset within 5s of epoch-derived target ${new Date(targetMs).toISOString()}, got reset=${limits[0].reset.toISOString()} (drift=${drift}ms)`
    )
  })
})
