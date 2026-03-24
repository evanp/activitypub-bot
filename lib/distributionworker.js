import { nanoid } from 'nanoid'

import as2 from './activitystreams.js'

export class DistributionWorker {
  static #QUEUE_ID = 'distribution'
  static #MAX_ATTEMPTS = 21 // ~24 days
  #jobQueue
  #client
  #logger
  #running
  #workerId

  constructor (jobQueue, client, logger) {
    this.#jobQueue = jobQueue
    this.#client = client
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
      let payload
      let attempts
      try {
        this.#logger.debug('dequeueing');
        ({ jobId, payload, attempts } = await this.#jobQueue.dequeue(
          DistributionWorker.#QUEUE_ID,
          this.#workerId
        ))
        this.#logger.debug({ jobId, payload, attempts }, 'got a job')
        const { inbox, activity, username } = payload
        const activityObj = await as2.import(activity)
        try {
          await this.#client.post(inbox, activityObj, username)
          this.#logger.info(`Delivered ${activity.id} to ${inbox}`)
          await this.#jobQueue.complete(jobId, this.#workerId)
          this.#logger.info({ jobId }, 'completed job')
        } catch (error) {
          if (!error.status) {
            this.#logger.warn(
              { error, activity: activity.id, inbox },
              'Could not deliver activity and no HTTP status available')
            await this.#jobQueue.fail(jobId, this.#workerId)
          } else if (error.status >= 300 && error.status < 400) {
            this.#logger.warn(
              { error, activity: activity.id, inbox },
              'Could not deliver activity and unexpected redirect code'
            )
            await this.#jobQueue.fail(jobId, this.#workerId)
          } else if (error.status >= 400 && error.status < 500) {
            this.#logger.warn(
              { error, activity: activity.id, inbox },
              'Could not deliver activity due to client error'
            )
            await this.#jobQueue.fail(jobId, this.#workerId)
          } else if (error.status >= 500 && error.status < 600) {
            if (attempts >= DistributionWorker.#MAX_ATTEMPTS) {
              this.#logger.warn(
                { error, activity: activity.id, inbox, attempts },
                'Could not deliver activity due to server error; no more attempts'
              )
              await this.#jobQueue.fail(jobId, this.#workerId)
            } else {
              const delay = Math.round((2 ** (attempts - 1) * 1000) * (0.5 + Math.random()))
              this.#logger.warn(
                { error, activity: activity.id, inbox, attempts, delay },
                'Could not deliver activity due to server error; will retry'
              )
              await this.#jobQueue.retryAfter(jobId, this.#workerId, delay)
            }
          }
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          this.#logger.info('Worker received abort signal')
          break
        }
        this.#logger.warn({ err, jobId }, 'Error delivering to bot')
        if (jobId) {
          await this.#jobQueue.release(jobId, this.#workerId)
        }
      }
    }
  }

  stop () {
    this.#running = false
  }
}
