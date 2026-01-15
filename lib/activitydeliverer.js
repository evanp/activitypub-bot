import BotMaker from './botmaker.js'
import assert from 'node:assert'

export class ActivityDeliverer {
  #actorStorage
  #activityHandler
  #formatter
  #logger
  #client

  constructor (actorStorage, activityHandler, formatter, logger, client) {
    this.#actorStorage = actorStorage
    this.#activityHandler = activityHandler
    this.#formatter = formatter
    this.#logger = logger
    this.#client = client
  }

  isActivity (object) {
    return true
  }

  getActor (activity) {
    return activity.actor?.first
  }

  getRecipients (obj) {
    let r = []
    for (const prop of ['to', 'cc', 'audience']) {
      const val = obj.get(prop)
      if (val) {
        r = r.concat(Array.from(val))
      }
    }
    return r
  }

  async deliverTo (activity, bot) {
    try {
      await this.#activityHandler.handleActivity(bot, activity)
    } catch (err) {
      this.#logger.warn(err)
    }

    await this.#actorStorage.addToCollection(bot.username, 'inbox', activity)
  }

  async deliverToAll (activity, bots) {
    const deliveredTo = new Set()
    const actor = this.getActor(activity)
    const recipients = this.getRecipients(activity)

    for (const recipient of recipients) {
      if (this.#formatter.isLocal(recipient.id)) {
        if (this.#formatter.isActor(recipient.id)) {
          const { username } = this.#formatter.unformat(recipient.id)
          if (!deliveredTo.has(username)) {
            const bot = await BotMaker.makeBot(bots, username)
            if (!bot) {
              this.#logger.warn(`sharedInbox direct delivery for unknown bot ${username}`)
              continue
            }
            await this.deliverTo(activity, bot)
            deliveredTo.add(username)
          }
        } else {
          this.#logger.warn(
            `Unrecognized recipient for remote delivery: ${recipient.id}`
          )
        }
      } else if (await this.isFollowersCollection(actor, recipient)) {
        const followers = await this.getLocalFollowers(actor)
        for (const username of followers) {
          if (!deliveredTo.has(username)) {
            const bot = await BotMaker.makeBot(bots, username)
            if (!bot) {
              this.#logger.warn(`sharedInbox direct delivery for unknown bot ${username}`)
              continue
            }
            await this.deliverTo(activity, bot)
            deliveredTo.add(username)
          }
        }
      } else {
        this.#logger.warn(`Unrecognized recipient for shared inbox: ${recipient.id}`)
      }
    }
  }

  async isFollowersCollection (actor, object) {
    assert.strictEqual(typeof actor, 'object')
    assert.strictEqual(typeof actor.id, 'string')
    assert.strictEqual(typeof object, 'object')
    assert.strictEqual(typeof object.id, 'string')

    if (actor.followers?.first?.id === object.id &&
      URL.parse(actor.id).origin === URL.parse(object.id).origin) {
      return true
    }

    const fullActor = await this.#client.get(actor.id)

    if (fullActor.followers?.first?.id === object.id) {
      return true
    }

    return false
  }

  async getLocalFollowers (actor) {
    return await this.#actorStorage.getUsernamesWith('following', actor)
  }
}
