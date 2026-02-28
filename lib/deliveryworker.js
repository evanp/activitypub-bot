import { nanoid } from 'nanoid'

import as2 from './activitystreams.js'

export class DeliveryWorker {
  static #QUEUE_ID = 'delivery'
  #queue
  #actorStorage
  #activityHandler
  #logger
  #running
  #workerId
  #bots

  constructor (queue, actorStorage, activityHandler, logger, bots) {
    this.#queue = queue
    this.#actorStorage = actorStorage
    this.#activityHandler = activityHandler
    this.#workerId = nanoid()
    this.#logger = logger.child({
      class: this.constructor.name,
      worker: this.#workerId
    })
    this.#bots = bots
  }

  async run () {
    this.#running = true
    while (this.#running) {
      let jobId
      let payload
      try {
        this.#logger.debug('dequeueing');
        ({ jobId, payload } = await this.#queue.dequeue(
          DeliveryWorker.#QUEUE_ID,
          this.#workerId
        ))
        this.#logger.debug({ jobId, payload }, 'got a job')
        const activity = await as2.import(payload.activity)
        const bot = this.#bots[payload.botUsername]
        this.#logger.debug({ bot: bot.username, activity: activity.id, jobId }, 'delivering to bot')
        await this.#deliverTo(activity, bot)
        this.#logger.debug({ bot: bot.username, activity: activity.id, jobId }, 'done')
        await this.#queue.complete(jobId, this.#workerId)
      } catch (err) {
        if (err?.name === 'AbortError') {
          this.#logger.info('Worker received abort signal')
          break
        }
        this.#logger.warn({ err, jobId }, 'Error delivering to bot')
        if (jobId) {
          await this.#queue.release(jobId, this.#workerId)
        }
      }
    }
  }

  stop () {
    this.#running = false
  }

  async #deliverTo (activity, bot) {
    if (await this.#actorStorage.isInCollection(bot.username, 'inbox', activity)) {
      this.#logger.info(
        { activity: activity.id, username: bot.username },
        'skipping redelivery for activity already in the inbox'
      )
      return
    }
    try {
      await this.#activityHandler.handleActivity(bot, activity)
    } catch (err) {
      this.#logger.warn(err)
    }
    this.#logger.debug(`Adding ${activity.id} to ${bot.username} inbox`)
    await this.#actorStorage.addToCollection(bot.username, 'inbox', activity)
    this.#logger.debug(`Done adding ${activity.id} to ${bot.username} inbox`)
  }
}
