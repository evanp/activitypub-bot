import BotMaker from './botmaker.js'
import assert from 'node:assert'
import as2 from 'activitystrea.ms'

const NS = 'https://www.w3.org/ns/activitystreams#'

const PUBLIC = [
  `${NS}Public`,
  'as:Public',
  'Public'
]

const COLLECTION_TYPES = [
  `${NS}Collection`,
  `${NS}OrderedCollection`
]

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
    this.#logger.debug(`Adding ${activity.id} to ${bot.username} inbox`)
    await this.#actorStorage.addToCollection(bot.username, 'inbox', activity)
  }

  async deliverToAll (activity, bots) {
    const deliveredTo = new Set()
    const actor = this.getActor(activity)
    const recipients = this.getRecipients(activity)

    for (const recipient of recipients) {
      if (this.#isPublic(recipient)) {
        await this.#deliverPublic(activity, bots)
      } else if (this.#isLocal(recipient)) {
        const parts = this.#formatter.unformat(recipient.id)
        if (this.#isLocalActor(parts)) {
          await this.#deliverLocalActor(activity, recipient, bots, deliveredTo)
        } else if (this.#isLocalFollowersCollection(parts)) {
          await this.#deliverLocalFollowersCollection(activity, parts.username, bots, deliveredTo)
        } else if (this.#isLocalFollowingCollection(parts)) {
          await this.#deliverLocalFollowingCollection(activity, parts.username, bots, deliveredTo)
        } else {
          this.#logger.warn(
            `Unrecognized recipient for remote delivery: ${recipient.id}`
          )
        }
      } else {
        if (await this.#isRemoteCollection(recipient, actor)) {
          await this.#deliverRemoteCollection(activity, recipient, actor, deliveredTo, bots)
        } else if (await this.#isRemoteActor(recipient)) {
          this.#logger.warn(`Skipping remote actor ${recipient.id}`)
        } else {
          this.#logger.warn(`Unrecognized recipient: ${recipient.id}`)
        }
      }
    }
  }

  async #isFollowersCollection (actor, object) {
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

  async #deliverLocalActor (activity, recipient, bots, deliveredTo) {
    const { username } = this.#formatter.unformat(recipient.id)
    if (!deliveredTo.has(username)) {
      const bot = await BotMaker.makeBot(bots, username)
      if (!bot) {
        this.#logger.warn(`sharedInbox direct delivery for unknown bot ${username}`)
      }
      await this.deliverTo(activity, bot)
      deliveredTo.add(username)
    }
  }

  async #deliverRemoteCollection (activity, recipient, actor, deliveredTo, bots) {
    if (await this.#isFollowersCollection(actor, recipient)) {
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
      this.#logger.warn(`Skipping non-followers remote collection ${recipient.id}`)
    }
  }

  #isPublic (recipient) {
    return PUBLIC.includes(recipient.id)
  }

  #isLocal (recipient) {
    return this.#formatter.isLocal(recipient.id)
  }

  #isLocalActor (parts) {
    return parts.username && !parts.collection && !parts.type
  }

  #isLocalFollowersCollection (parts) {
    return parts.username && (parts.collection === 'followers')
  }

  #isLocalFollowingCollection (parts) {
    return parts.username && (parts.collection === 'following')
  }

  async #isRemoteCollection (recipient) {
    assert.strictEqual(typeof recipient, 'object')
    assert.strictEqual(typeof recipient.id, 'string')

    const object = await this.#client.get(recipient.id)

    return (Array.isArray(object.type))
      ? object.type.some(item => COLLECTION_TYPES.includes(item))
      : COLLECTION_TYPES.includes(object.type)
  }

  async #isRemoteActor (recipient) {
    assert.strictEqual(typeof recipient, 'object')
    assert.strictEqual(typeof recipient.id, 'string')

    const object = await this.#client.get(recipient.id)

    return !!object.inbox?.first?.id
  }

  async #deliverPublic (activity, bots) {
    await Promise.all(Object.values(bots).map(bot => bot.onPublic(activity)))
  }

  async #deliverLocalFollowersCollection (activity, username, bots, deliveredTo) {
    const id = this.#formatter.format({ username })
    const followed = await as2.import({ id })
    const followers = await this.#actorStorage.getUsernamesWith('following', followed)
    for (const follower of followers) {
      if (!deliveredTo.has(follower)) {
        const bot = await BotMaker.makeBot(bots, follower)
        if (!bot) {
          this.#logger.warn(`sharedInbox delivery for unknown bot ${follower}`)
          continue
        }
        await this.deliverTo(activity, bot)
        deliveredTo.add(follower)
      }
    }
  }

  async #deliverLocalFollowingCollection (activity, username, bots, deliveredTo) {
    const id = this.#formatter.format({ username })
    const following = await as2.import({ id })
    const followeds = await this.#actorStorage.getUsernamesWith('followers', following)
    for (const followed of followeds) {
      if (!deliveredTo.has(followed)) {
        const bot = await BotMaker.makeBot(bots, followed)
        if (!bot) {
          this.#logger.warn(`sharedInbox delivery for unknown bot ${followed}`)
          continue
        }
        await this.deliverTo(activity, bot)
        deliveredTo.add(followed)
      }
    }
  }
}
