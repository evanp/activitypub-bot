import assert from 'node:assert'

import { nanoid } from 'nanoid'

import as2 from './activitystreams.js'

export class FanoutWorker {
  static #QUEUE_ID = 'fanout'
  #jobQueue
  #distributor
  #logger
  #running
  #workerId

  constructor (jobQueue, distributor, logger) {
    this.#jobQueue = jobQueue
    this.#distributor = distributor
    this.#workerId = nanoid()
    this.#logger = logger.child({
      class: this.constructor.name,
      workerId: this.#workerId
    })
  }

  async run () {
    this.#running = true
    while (this.#running) {
      let jobId
      let attempts
      let payload
      let username
      let activity

      try {
        this.#logger.debug('dequeueing');
        ({ jobId, payload, attempts } = await this.#jobQueue.dequeue(
          FanoutWorker.#QUEUE_ID,
          this.#workerId
        ))
        this.#logger.debug({ jobId, attempts }, 'got a job')
        const raw = payload.activity
        username = payload.username
        activity = await as2.import(raw)
      } catch (err) {
        if (err?.name === 'AbortError') {
          this.#logger.info('Worker received abort signal')
          break
        } else {
          this.#logger.warn({ err, jobId }, 'error before fanout, retrying')
          if (jobId) {
            const delay = this.#retryDelay(attempts ?? 1)
            await this.#jobQueue.retryAfter(jobId, this.#workerId, delay)
          }
          continue
        }
      }

      assert.ok(activity)
      assert.strictEqual(typeof activity, 'object')
      assert.ok(username)
      assert.strictEqual(typeof username, 'string')

      try {
        await this.#distributor.fanout(activity, username)
        await this.#jobQueue.complete(jobId, this.#workerId)
        this.#logger.info({ jobId }, 'completed fanout job')
      } catch (err) {
        this.#logger.warn(
          { err, jobId, activity: activity.id },
          'fanout failed, not retrying'
        )
        await this.#jobQueue.fail(jobId, this.#workerId)
        continue
      }
    }
  }

  #retryDelay (attempts) {
    return Math.round((2 ** (attempts - 1) * 1000) * (0.5 + Math.random()))
  }

  stop () {
    this.#running = false
  }
}
