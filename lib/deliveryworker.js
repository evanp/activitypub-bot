import assert from 'node:assert'

import as2 from './activitystreams.js'
import BotMaker from './botmaker.js'
import { Worker } from './worker.js'

export class DeliveryWorker extends Worker {
  #actorStorage
  #activityHandler
  #bots

  constructor (jobQueue, logger, options = {}) {
    super(jobQueue, logger, options)
    assert.ok(options.actorStorage)
    assert.ok(options.activityHandler)
    assert.ok(options.bots)
    this.#actorStorage = options.actorStorage
    this.#activityHandler = options.activityHandler
    this.#bots = options.bots
  }

  async doJob (payload, attempts) {
    const activity = await as2.import(payload.activity)
    assert.ok(payload.botUsername)
    const bot = await BotMaker.makeBot(this.#bots, payload.botUsername)
    assert.ok(bot)
    assert.ok(bot.username)
    this._logger.debug(
      { bot: bot.username, activity: activity.id },
      'delivering to bot'
    )
    await this.#deliverTo(activity, bot)
    this._logger.debug({ bot: bot.username, activity: activity.id }, 'done')
  }

  async #deliverTo (activity, bot) {
    assert.ok(activity)
    assert.strictEqual(typeof activity, 'object')
    assert.ok(bot)
    assert.strictEqual(typeof bot, 'object')
    assert.strictEqual(typeof bot.username, 'string')
    if (await this.#actorStorage.isInCollection(bot.username, 'inbox', activity)) {
      this._logger.info(
        { activity: activity.id, username: bot.username },
        'skipping redelivery for activity already in the inbox'
      )
      return
    }
    try {
      await this.#activityHandler.handleActivity(bot, activity)
    } catch (err) {
      this._logger.warn(
        { err, activity: activity.id, bot: bot.username },
        'handler failed for activity'
      )
    }
    this._logger.debug({ activity: activity.id, bot: bot.username }, 'Adding to inbox')
    await this.#actorStorage.addToCollection(bot.username, 'inbox', activity)
    this._logger.debug({ activity: activity.id, bot: bot.username }, 'Done adding to inbox')
  }
}
