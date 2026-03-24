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
            if (error.status === 429) {
              this.#logger.debug(
                { error, activity: activity.id, inbox },
                'Retrying on 429 status'
              )
              const delay = this.#retryDelay(error.headers, attempts)
              await this.#jobQueue.retryAfter(jobId, this.#workerId, delay)
            } else {
              await this.#jobQueue.fail(jobId, this.#workerId)
            }
          } else if (error.status >= 500 && error.status < 600) {
            if (attempts >= DistributionWorker.#MAX_ATTEMPTS) {
              this.#logger.warn(
                { error, activity: activity.id, inbox, attempts },
                'Could not deliver activity due to server error; no more attempts'
              )
              await this.#jobQueue.fail(jobId, this.#workerId)
            } else {
              const delay = this.#retryDelay(error.headers, attempts)
              this.#logger.warn(
                { error, activity: activity.id, inbox, attempts, delay },
                'Could not deliver activity due to server error; will retry'
              )
              await this.#jobQueue.retryAfter(jobId, this.#workerId, delay)
            }
          } else {
            this.#logger.warn(
              { error, activity: activity.id, inbox },
              'Could not deliver activity due to unexpected status range'
            )
            await this.#jobQueue.fail(jobId, this.#workerId)
          }
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          this.#logger.info('Worker received abort signal')
          break
        }
        this.#logger.warn({ err, jobId }, 'Error delivering to bot')
        if (jobId) {
          const delay = this.#retryDelay(null, attempts ?? 1)
          this.#logger.warn(
            { err, jobId, attempts, delay },
            'Retrying job after a delay'
          )
          await this.#jobQueue.retryAfter(jobId, this.#workerId, delay)
        }
      }
    }
  }

  #retryDelay (headers, attempts) {
    if (headers?.['retry-after']) {
      this.#logger.debug('using retry-after header')
      const retryAfter = headers['retry-after']
      if (/^\d+$/.test(retryAfter)) {
        return parseInt(retryAfter, 10) * 1000
      } else {
        return new Date(retryAfter) - Date.now()
      }
    }
    this.#logger.debug('exponential backoff')
    return Math.round((2 ** (attempts - 1) * 1000) * (0.5 + Math.random()))
  }

  stop () {
    this.#running = false
  }
}
