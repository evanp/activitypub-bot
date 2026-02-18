import BotMaker from './botmaker.js'
import assert from 'node:assert'
import as2 from './activitystreams.js'
import PQueue from 'p-queue'
import * as ttlcachePkg from '@isaacs/ttlcache'

const TTLCache =
  ttlcachePkg.TTLCache ?? ttlcachePkg.default ?? ttlcachePkg

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
  static #MAX_ALL_QUEUE = 16
  static #MAX_BOT_QUEUE = 32
  static #TTL_SEEN_PUBLIC = 3 * 24 * 60 * 60 * 1000 // 3 days
  static #MAX_SEEN_PUBLIC = 1000000
  #actorStorage
  #activityHandler
  #formatter
  #logger
  #client
  #deliverAllQueue
  #deliverBotQueue
  #seenPublic

  constructor (actorStorage, activityHandler, formatter, logger, client) {
    this.#actorStorage = actorStorage
    this.#activityHandler = activityHandler
    this.#formatter = formatter
    this.#client = client
    this.#logger = logger.child({ class: this.constructor.name })
    this.#deliverAllQueue = new PQueue({ max: ActivityDeliverer.#MAX_ALL_QUEUE })
    this.#deliverBotQueue = new PQueue({ max: ActivityDeliverer.#MAX_BOT_QUEUE })
    this.#seenPublic = new TTLCache({
      ttl: ActivityDeliverer.#TTL_SEEN_PUBLIC,
      max: ActivityDeliverer.#MAX_SEEN_PUBLIC
    })
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

  isPublic (activity) {
    for (const prop of ['to', 'cc', 'audience']) {
      const vals = activity.get(prop)
      if (vals) {
        for (const val of vals) {
          if (this.#isPublic(val)) {
            return true
          }
        }
      }
    }
    return false
  }

  async deliverPublic (activity, bots) {
    if (!this.#seenPublic.has(activity.id)) {
      await Promise.all(Object.values(bots).map(async (bot) => {
        let result
        try {
          result = await bot.onPublic(activity)
        } catch (err) {
          this.#logger.warn(
            { err, activity: activity.id, bot: bot.id },
            'Error handling public activity for bot'
          )
        }
        return result
      }))
      this.#seenPublic.set(activity.id, true)
    }
  }

  async deliverTo (activity, bot) {
    this.#deliverBotQueue.add(() =>
      this.#deliverTo(activity, bot)
    )
  }

  async onIdle () {
    this.#logger.debug('Awaiting delivery queues')
    await this.#deliverAllQueue.onIdle()
    await this.#deliverBotQueue.onIdle()
    this.#logger.debug('Done awaiting delivery queues')
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

  async deliverToAll (activity, bots) {
    this.#deliverAllQueue.add(() =>
      this.#deliverToAll(activity, bots)
    )
  }

  async #deliverToAll (activity, bots) {
    const deliveredTo = new Set()
    const actor = this.getActor(activity)
    const recipients = this.getRecipients(activity)

    for (const recipient of recipients) {
      this.#logger.debug(`Checking recipient ${recipient.id}`)
      if (this.#isPublic(recipient)) {
        this.#logger.debug(`Public recipient for ${activity.id}`)
        await this.deliverPublic(activity, bots)
      } else if (this.#isLocal(recipient)) {
        this.#logger.debug(`Local recipient for ${activity.id}`)
        const parts = this.#formatter.unformat(recipient.id)
        if (this.#isLocalActor(parts)) {
          this.#logger.debug(`Local actor ${recipient.id} for ${activity.id}`)
          await this.#deliverLocalActor(activity, recipient, bots, deliveredTo)
        } else if (this.#isLocalFollowersCollection(parts)) {
          this.#logger.debug(`Local followers for ${parts.username} for ${activity.id}`)
          await this.#deliverLocalFollowersCollection(activity, parts.username, bots, deliveredTo)
        } else if (this.#isLocalFollowingCollection(parts)) {
          this.#logger.debug(`Local following for ${parts.username} for ${activity.id}`)
          await this.#deliverLocalFollowingCollection(activity, parts.username, bots, deliveredTo)
        } else {
          this.#logger.warn(
            `Unrecognized recipient for remote delivery: ${recipient.id}`
          )
        }
      } else {
        const fullActor = await this.#client.get(actor.id)
        const fullRecipient = await this.#client.get(recipient.id)
        if (await this.#isRemoteActor(fullRecipient)) {
          this.#logger.warn(`Skipping remote actor ${recipient.id}`)
        } else if (await this.#isRemoteFollowersCollection(fullActor, fullRecipient)) {
          this.#logger.debug(`Remote followers for ${fullActor.id} for ${activity.id}`)
          await this.#deliverRemoteFollowersCollection(activity, fullRecipient, fullActor, deliveredTo, bots)
        } else if (await this.#isRemoteFollowingCollection(fullActor, fullRecipient)) {
          this.#logger.debug(`Remote following for ${fullActor.id} for ${activity.id}`)
          await this.#deliverRemoteFollowingCollection(activity, fullRecipient, fullActor, deliveredTo, bots)
        } else if (await this.#isRemoteCollection(fullRecipient)) {
          this.#logger.debug(`Remote collection ${fullRecipient.id} for ${activity.id}`)
          await this.#deliverRemoteCollection(activity, fullRecipient, deliveredTo, bots)
        } else {
          this.#logger.warn(`Unrecognized recipient: ${recipient.id}`)
        }
      }
    }
  }

  async #isRemoteFollowersCollection (actor, object) {
    assert.strictEqual(typeof actor, 'object')
    assert.strictEqual(typeof actor.id, 'string')
    assert.strictEqual(typeof object, 'object')
    assert.strictEqual(typeof object.id, 'string')

    return (actor.followers?.first?.id === object.id)
  }

  async #isRemoteFollowingCollection (actor, object) {
    assert.strictEqual(typeof actor, 'object')
    assert.strictEqual(typeof actor.id, 'string')
    assert.strictEqual(typeof object, 'object')
    assert.strictEqual(typeof object.id, 'string')

    return (actor.following?.first?.id === object.id)
  }

  async #getLocalFollowers (actor) {
    return await this.#actorStorage.getUsernamesWith('following', actor)
  }

  async #getLocalFollowing (actor) {
    return await this.#actorStorage.getUsernamesWith('followers', actor)
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

  async #deliverRemoteFollowersCollection (activity, recipient, actor, deliveredTo, bots) {
    const followers = await this.#getLocalFollowers(actor)
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
  }

  async #deliverRemoteFollowingCollection (activity, recipient, actor, deliveredTo, bots) {
    const following = await this.#getLocalFollowing(actor)
    for (const username of following) {
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

    return (Array.isArray(recipient.type))
      ? recipient.type.some(item => COLLECTION_TYPES.includes(item))
      : COLLECTION_TYPES.includes(recipient.type)
  }

  async #isRemoteActor (recipient) {
    assert.strictEqual(typeof recipient, 'object')
    assert.strictEqual(typeof recipient.id, 'string')

    return !!recipient.inbox?.first?.id
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

  async #deliverRemoteCollection (activity, recipient, deliveredTo, bots) {
    for await (const item of this.#client.items(recipient.id)) {
      this.#logger.debug(`item: ${JSON.stringify(item)}`)
      if (this.#isLocal(item)) {
        const parts = this.#formatter.unformat(item.id)
        if (this.#isLocalActor(parts)) {
          const bot = await BotMaker.makeBot(bots, parts.username)
          if (!bot) {
            this.#logger.warn(`sharedInbox delivery for unknown bot ${parts.username}`)
            continue
          }
          await this.deliverTo(activity, bot)
          deliveredTo.add(parts.username)
        }
      }
    }
  }
}
