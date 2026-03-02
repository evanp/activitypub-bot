import { nanoid } from 'nanoid'

import as2 from './activitystreams.js'

export class DistributionWorker {
  static #QUEUE_ID = 'distribution'
  static #MAX_ATTEMPTS = 16
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
            this.#logger.error(`Could not deliver ${activity.id} to ${inbox}: ${error.message}`)
            this.#logger.error(error.stack)
          } else if (error.status >= 300 && error.status < 400) {
            this.#logger.error(`Unexpected redirect code delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}`)
          } else if (error.status >= 400 && error.status < 500) {
            this.#logger.error(`Bad request delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}`)
          } else if (error.status >= 500 && error.status < 600) {
            if (attempts >= DistributionWorker.#MAX_ATTEMPTS) {
              this.#logger.error(`Server error delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}; giving up after ${attempts} attempts`)
              await this.#jobQueue.complete(jobId, this.#workerId)
            } else {
              const delay = Math.round((2 ** (attempts - 1) * 1000) * (0.5 + Math.random()))
              this.#logger.warn(`Server error delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}; will retry in ${delay} ms (${attempts} of ${DistributionWorker.#MAX_ATTEMPTS})`)
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
