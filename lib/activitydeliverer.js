import BotMaker from './botmaker.js'
import assert from 'node:assert'
import as2 from './activitystreams.js'

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
    this.#client = client
    this.#logger = logger.child({ class: this.constructor.name })
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
        const fullActor = await this.#client.get(actor.id)
        const fullRecipient = await this.#client.get(recipient.id)
        if (await this.#isRemoteActor(fullRecipient)) {
          this.#logger.warn(`Skipping remote actor ${recipient.id}`)
        } else if (await this.#isRemoteFollowersCollection(fullActor, fullRecipient)) {
          await this.#deliverRemoteFollowersCollection(activity, fullRecipient, fullActor, deliveredTo, bots)
        } else if (await this.#isRemoteFollowingCollection(fullActor, fullRecipient)) {
          await this.#deliverRemoteFollowingCollection(activity, fullRecipient, fullActor, deliveredTo, bots)
        } else if (await this.#isRemoteCollection(fullRecipient)) {
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
