import { setTimeout as sleep } from 'node:timers/promises'

const DEFAULT_TIMEOUT = 5 * 60 * 1000 // 5 minutes
const DEFAULT_INTERVAL = 60 * 1000 // 1 minute

export class JobReaper {
  #jobQueue
  #logger
  #timeout
  #interval
  #ac

  constructor (jobQueue, logger, { timeout = DEFAULT_TIMEOUT, interval = DEFAULT_INTERVAL } = {}) {
    this.#jobQueue = jobQueue
    this.#logger = logger.child({ class: this.constructor.name })
    this.#timeout = timeout
    this.#interval = interval
    this.#ac = new AbortController()
  }

  async run () {
    this.#logger.debug('JobReaper started')
    while (!this.#ac.signal.aborted) {
      try {
        await sleep(this.#interval, null, { signal: this.#ac.signal })
      } catch {
        break
      }
      await this.#jobQueue.sweep(this.#timeout)
    }
    this.#logger.debug('JobReaper stopped')
  }

  stop () {
    this.#logger.debug('Stopping JobReaper')
    this.#ac.abort()
  }
}
