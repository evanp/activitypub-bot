import assert from 'node:assert'

import as2 from './activitystreams.js'
import { Worker } from './worker.js'

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
    await this.#distributor.fanout(activity, username)
  }
}
