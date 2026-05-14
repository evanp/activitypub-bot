import { setTimeout as sleep } from 'node:timers/promises'
import assert from 'node:assert'

const BETA = 0.75
const EPOCH_THRESHOLD = 30 * 24 * 60 * 60
const DEFAULT_RESET = 30 * 1000

export class ThrottleError extends Error {
  constructor (message, waitTime) {
    super(message)
    this.name = this.constructor.name
    this.waitTime = waitTime
  }
}

export class RequestThrottler {
  #connection
  #logger

  constructor (connection, logger) {
    assert.strictEqual(typeof connection, 'object')
    assert.strictEqual(typeof logger, 'object')
    this.#connection = connection
    this.#logger = logger.child({ class: this.constructor.name })
  }

  async throttle (host, maxWaitTime = 30000) {
    assert.strictEqual(typeof host, 'string')
    assert.strictEqual(typeof maxWaitTime, 'number')
    const waitTime = await this.#getWaitTime(host, maxWaitTime)
    if (waitTime > maxWaitTime) {
      throw new ThrottleError(
        `Wait time is too long; ${waitTime} > ${maxWaitTime}`,
        waitTime
      )
    }
    if (waitTime > 0) {
      await this.#decrement(host)
      await sleep(waitTime)
    }
  }

  async update (host, headers) {
    assert.strictEqual(typeof host, 'string')
    assert.strictEqual(typeof headers, 'object')

    const retryAfterHeader = headers.get('retry-after')
    const resetHeader = headers.get('x-ratelimit-reset')
    const remainingHeader = headers.get('x-ratelimit-remaining')

    if (retryAfterHeader) {
      const remaining = 0
      const reset = this.#headerToReset(retryAfterHeader)
      this.#logger.debug(
        { reset, remaining, host, retryAfterHeader },
        'updating'
      )
      await this.#connection.query(
        `INSERT INTO rate_limit (host, remaining, reset)
        VALUES (?, ?, ?)
        ON CONFLICT (host) DO UPDATE
        SET remaining = EXCLUDED.remaining,
            reset = EXCLUDED.reset,
            updated_at = CURRENT_TIMESTAMP`,
        { replacements: [host, remaining, reset] }
      )
    } else if (resetHeader && remainingHeader) {
      const remaining = parseInt(remainingHeader)
      const reset = this.#headerToReset(resetHeader)
      this.#logger.debug(
        { reset, remaining, host, resetHeader, remainingHeader },
        'updating'
      )
      await this.#connection.query(
        `INSERT INTO rate_limit (host, remaining, reset)
        VALUES (?, ?, ?)
        ON CONFLICT (host) DO UPDATE
        SET remaining = EXCLUDED.remaining,
            reset = EXCLUDED.reset,
            updated_at = CURRENT_TIMESTAMP`,
        { replacements: [host, remaining, reset] }
      )
    } else if (headers.get('server') === 'Mastodon') {
      const limits = await this.peek(host)
      if (!limits || limits.length === 0 || limits[0].reset < (new Date())) {
        const remaining = 299 // 300 - 1 for the current request
        const reset = new Date(Math.ceil(Date.now() / 300000) * 300000)
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
  }

  async peek (host) {
    const [result] = await this.#connection.query(
      'SELECT remaining, reset FROM rate_limit WHERE host = ?',
      { replacements: [host] }
    )

    if (result.length === 0) {
      return []
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

  #headerToReset (header) {
    let reset
    if (header.match(/^\d+$/)) {
      const resetSeconds = parseInt(header)
      if (resetSeconds < EPOCH_THRESHOLD) {
        reset = new Date(Date.now() + (resetSeconds * 1000))
      } else {
        reset = new Date(resetSeconds * 1000)
      }
    } else {
      reset = new Date(header)
      if (isNaN(reset.getTime())) {
        this.#logger.warn(
          { header },
          'Error parsing header for request throttling'
        )
        reset = new Date(Date.now() + DEFAULT_RESET)
      }
    }
    return reset
  }
}
