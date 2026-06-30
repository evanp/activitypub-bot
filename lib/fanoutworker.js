import assert from 'node:assert'

import as2 from './activitystreams.js'
import { Worker } from './worker.js'
import { RecoverableError } from './errors/recoverableerror.js'
import { ThrottleError } from './errors/throttleerror.js'

export class FanoutWorker extends Worker {
  #distributor

  constructor (jobQueue, logger, options = {}) {
    super(jobQueue, logger, options)
    assert.ok(options.distributor)
    this.#distributor = options.distributor
  }

  async doJob (payload, attempts) {
    const activity = await as2.import(payload.activity)
    const { username } = payload
    try {
      await this.#distributor.fanout(activity, username)
    } catch (err) {
      if (err instanceof ThrottleError) {
        this._logger.warn(
          { err, activity: activity.id, username },
          'Throttled fanout, waiting to retry')
        throw new RecoverableError(err.message, err.waitTime)
      } else {
        throw err
      }
    }
  }
}
