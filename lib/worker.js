import assert from 'node:assert'
import { nanoid } from 'nanoid'

export class RecoverableError extends Error {
  delay
  constructor (message, delay = 1000) {
    super(message)
    this.name = this.constructor.name
    this.delay = delay
  }
}

export class Worker {
  #jobQueue
  #logger
  #running
  #workerId

  constructor (jobQueue, logger, options = {}) {
    this.#jobQueue = jobQueue
    this.#workerId = nanoid()
    this.#logger = logger.child({
      class: this.constructor.name,
      worker: this.#workerId
    })
  }

  get _logger () {
    return this.#logger
  }

  get queueId () {
    const name = this.constructor.name
    return name.slice(0, name.length - 6).toLowerCase()
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
          this.queueId,
          this.#workerId
        ))
        this.#logger.debug({ jobId, payload, attempts }, 'got a job')
      } catch (err) {
        if (err?.name === 'AbortError') {
          this.#logger.info('Worker received abort signal')
          break
        } else {
          this.#logger.warn({ err, jobId }, 'error before job, retrying')
          if (jobId) {
            const delay = this.#retryDelay(attempts ?? 1)
            await this.#jobQueue.retryAfter(jobId, this.#workerId, delay)
          }
          continue
        }
      }

      assert.ok(jobId)
      assert.ok(payload)

      try {
        await this.doJob(payload, attempts)
        await this.#jobQueue.complete(jobId, this.#workerId)
      } catch (err) {
        if (err instanceof RecoverableError) {
          await this.#jobQueue.retryAfter(jobId, this.#workerId, err.delay)
        } else {
          await this.#jobQueue.fail(jobId, this.#workerId)
        }
      }
    }
  }

  async doJob (payload, attempts) {
    throw new Error('Must implement doJob')
  }

  stop () {
    this.#running = false
  }

  #retryDelay (attempts) {
    return Math.round((2 ** (attempts - 1) * 1000) * (0.5 + Math.random()))
  }
}
