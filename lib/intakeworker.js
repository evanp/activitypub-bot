import assert from 'node:assert'

import as2 from './activitystreams.js'
import { Worker, RecoverableError } from './worker.js'
import { ThrottleError } from './requestthrottler.js'

export class IntakeWorker extends Worker {
  #deliverer
  #bots
  constructor (jobQueue, logger, options = {}) {
    super(jobQueue, logger, options)
    assert.ok(options.deliverer)
    assert.ok(options.bots)
    this.#deliverer = options.deliverer
    this.#bots = options.bots
  }

  async doJob (payload, attempts) {
    const raw = payload.activity
    const activity = await as2.import(raw)
    try {
      await this.#deliverer.deliverToAll(activity, this.#bots)
    } catch (err) {
      if (err instanceof ThrottleError) {
        this._logger.warn(
          { err, activity: activity.id },
          'Throttled intake, waiting to retry')
        throw new RecoverableError(err.message, err.waitTime)
      } else {
        throw err
      }
    }
  }
}
