import assert from 'node:assert'

import as2 from './activitystreams.js'
import { Worker, RecoverableError } from './worker.js'

export class DistributionWorker extends Worker {
  static #MAX_ATTEMPTS = 21 // ~24 days
  #client

  constructor (jobQueue, logger, options = {}) {
    super(jobQueue, logger, options)
    assert.ok(options.client)
    this.#client = options.client
  }

  async doJob (payload, attempts) {
    const { inbox, activity, username } = payload
    const activityObj = await as2.import(activity)
    try {
      await this.#client.post(inbox, activityObj, username)
      this._logger.info({ activity: activity.id, inbox }, 'Delivered activity')
    } catch (err) {
      if (!err.status) {
        this._logger.warn(
          { err, activity: activity.id, inbox },
          'Could not deliver activity and no HTTP status available')
        throw err
      } else if (err.status >= 300 && err.status < 400) {
        this._logger.warn(
          { err, activity: activity.id, inbox },
          'Could not deliver activity and unexpected redirect code'
        )
        throw err
      } else if (err.status >= 400 && err.status < 500) {
        this._logger.warn(
          { err, activity: activity.id, inbox },
          'Could not deliver activity due to client error'
        )
        if ([408, 425, 429].includes(err.status)) {
          this._logger.debug(
            { err, activity: activity.id, inbox },
            'Retrying on recoverable status'
          )
          const recoverable = new RecoverableError(err.message)
          recoverable.delay = this.#retryDelay(err.headers, attempts)
          throw recoverable
        } else {
          throw err
        }
      } else if (err.status >= 500 && err.status < 600) {
        if ([501, 505, 508, 510].includes(err.status)) {
          this._logger.warn(
            { err, activity: activity.id, inbox, attempts },
            'Could not deliver activity due to unrecoverable server error'
          )
          throw err
        } else if (attempts >= DistributionWorker.#MAX_ATTEMPTS) {
          this._logger.warn(
            { err, activity: activity.id, inbox, attempts },
            'Could not deliver activity due to server error; no more attempts'
          )
          throw err
        } else {
          const recoverable = new RecoverableError(err.message)
          recoverable.delay = this.#retryDelay(err.headers, attempts)
          this._logger.warn(
            { err, activity: activity.id, inbox, attempts, delay: recoverable.delay },
            'Could not deliver activity due to server error; will retry'
          )
          throw recoverable
        }
      } else {
        this._logger.warn(
          { err, activity: activity.id, inbox },
          'Could not deliver activity due to unexpected status range'
        )
        throw err
      }
    }
  }

  #retryDelay (headers, attempts) {
    if (headers?.['retry-after']) {
      this._logger.debug('using retry-after header')
      const retryAfter = headers['retry-after']
      if (/^\d+$/.test(retryAfter)) {
        return parseInt(retryAfter, 10) * 1000
      } else {
        return new Date(retryAfter) - Date.now()
      }
    }
    this._logger.debug('exponential backoff')
    return Math.round((2 ** (attempts - 1) * 1000) * (0.5 + Math.random()))
  }
}
