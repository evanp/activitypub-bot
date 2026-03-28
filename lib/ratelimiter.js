import { setTimeout as sleep } from 'node:timers/promises'
import assert from 'node:assert'

const BETA = 0.75

export class RateLimiter {
  #connection
  #logger

  constructor (connection, logger) {
    assert.strictEqual(typeof connection, 'object')
    assert.strictEqual(typeof logger, 'object')
    this.#connection = connection
    this.#logger = logger
  }

  async limit (host, maxWaitTime = 30000) {
    assert.strictEqual(typeof host, 'string')
    assert.strictEqual(typeof maxWaitTime, 'number')
    const waitTime = await this.#getWaitTime(host, maxWaitTime)
    if (waitTime > maxWaitTime) {
      throw new Error(`Wait time is too long; ${waitTime} > ${maxWaitTime}`)
    }
    if (waitTime > 0) {
      await this.#decrement(host)
      await sleep(waitTime)
    }
  }

  async update (host, headers) {
    assert.strictEqual(typeof host, 'string')
    assert.strictEqual(typeof headers, 'object')

    const resetHeader = headers.get('x-ratelimit-reset')
    const remainingHeader = headers.get('x-ratelimit-remaining')

    if (resetHeader && remainingHeader) {
      const remaining = parseInt(remainingHeader)
      let resetSeconds
      let reset
      if (resetHeader.match(/^\d+$/)) {
        resetSeconds = parseInt(resetHeader)
        reset = new Date(Date.now() + (resetSeconds * 1000))
      } else {
        reset = new Date(resetHeader)
        resetSeconds = reset - Date.now()
      }
      this.#logger.debug({ reset, remaining, host }, 'updating')
      await this.#connection.query(
        `INSERT INTO rate_limit (host, remaining, reset)
        VALUES (?, ?, ?)
        ON CONFLICT (host) DO UPDATE
        SET remaining = EXCLUDED.remaining,
            reset = EXCLUDED.reset,
            updated_at = CURRENT_TIMESTAMP`,
        { replacements: [host, remaining, reset] }
      )
    }
  }

  async peek (host) {
    const [result] = await this.#connection.query(
      'SELECT remaining, reset FROM rate_limit WHERE host = ?',
      { replacements: [host] }
    )

    if (result.length === 0) {
      return 0
    }

    const { remaining, reset } = result[0]

    return [{ policy: 'default', remaining, reset: new Date(reset) }]
  }

  async #getWaitTime (host, maxWaitTime) {
    assert.strictEqual(typeof host, 'string')
    assert.ok(maxWaitTime > 0)

    const [result] = await this.#connection.query(
      'SELECT remaining, reset FROM rate_limit WHERE host = ?',
      { replacements: [host] }
    )

    if (result.length === 0) {
      return 0
    }

    const { remaining, reset } = result[0]
    const resetDate = new Date(reset)
    const now = new Date()
    const window = Math.round(resetDate - now)

    if (now > resetDate) {
      this.#logger.debug(
        { remaining, resetDate, host },
        'past epoch'
      )
      return 0
    }

    if (remaining === 0) {
      this.#logger.debug(
        { remaining, resetDate, host },
        'no more requests remaining'
      )
      return window
    }

    this.#logger.debug(
      { remaining, resetDate, host },
      'requests remain'
    )

    const space = (window / remaining)
    const waitTime = (space) * Math.pow(space / maxWaitTime, BETA)

    this.#logger.debug(
      { remaining, resetDate, host, waitTime },
      'wait time calculated'
    )
    return waitTime
  }

  async #decrement (host) {
    assert.strictEqual(typeof host, 'string')

    await this.#connection.query(
      `UPDATE rate_limit
       SET remaining = remaining - 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE host = ?`,
      { replacements: [host] }
    )
  }
}
