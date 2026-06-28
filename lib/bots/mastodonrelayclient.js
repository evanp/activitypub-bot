import assert from 'node:assert'

import Bot from '../bot.js'

const NS = 'https://www.w3.org/ns/activitystreams#'
const ACCEPT = `${NS}Accept`
const REJECT = `${NS}Reject`
const ANNOUNCE = `${NS}Announce`

export default class MastodonRelayClientBot extends Bot {
  #relay
  #relayForwarding
  #forceUnsubscribe
  constructor (username, options = {}) {
    if (typeof username !== 'string') {
      throw new Error('username must be a string')
    }
    if (typeof options !== 'object') {
      throw new Error('options must be an object')
    }
    if (typeof options.relay !== 'string' &&
        !Array.isArray(options.relay)) {
      throw new Error('relay option must be a string or array')
    }
    super(username, options)
    this.#relay = Array.isArray(options.relay)
      ? options.relay
      : [options.relay]
    this.#relayForwarding = ('relayForwarding' in options)
      ? options.relayForwarding
      : true
    if (options.forceUnsubscribe) {
      if (!Array.isArray(options.forceUnsubscribe)) {
        throw new Error('forceUnsubscribe option must be an array')
      }
      const fus = new Set(options.forceUnsubscribe)
      if (this.#relay.some(x => fus.has(x))) {
        throw new Error('forceUnsubscribe option must not overlap with relay option')
      }
    }
    this.#forceUnsubscribe = options.forceUnsubscribe || []
  }

  get type () {
    return 'Application'
  }

  get fullname () {
    return 'Mastodon Relay Client Bot'
  }

  get description () {
    return 'A bot for subscribing to relays'
  }

  async initialize (context) {
    await super.initialize(context)
    this._context.logger.info(
      { relay: this.#relay },
      'Initialising relay client'
    )

    assert.ok(Array.isArray(this.#forceUnsubscribe))

    for (const id of this.#forceUnsubscribe) {
      const actor = await this._context.getObject(id)
      if (actor) {
        try {
          await this.#unfollowRelay(actor)
        } catch (err) {
          this._context.logger.warn(
            { err, actorId: id },
            'Error unfollowing actor; skipping'
          )
        }
      }
    }

    assert.ok(Array.isArray(this.#relay))

    const toFollow = new Set(this.#relay)

    for await (const actor of this._context.following()) {
      if (toFollow.has(actor.id)) {
        toFollow.delete(actor.id)
      } else {
        await this.#unfollowRelay(actor)
      }
    }

    for (const id of toFollow) {
      const actor = await this._context.getObject(id)
      if (!await this.#hasFollowActivity(actor)) {
        await this.#followRelay(actor)
      }
    }
  }

  async handleActivity (activity) {
    this._context.logger.debug(
      'handling activity'
    )
    if (activity.type === ACCEPT) {
      return await this.#handleAccept(activity)
    } else if (activity.type === REJECT) {
      return await this.#handleReject(activity)
    } else if (activity.type === ANNOUNCE) {
      return await this.#handleAnnounce(activity)
    } else {
      return false
    }
  }

  async actorOK (actorId, activity) {
    return this.#relay.includes(actorId)
  }

  async #followRelay (actor) {
    this._context.logger.info(
      { relay: actor.id },
      'Following relay'
    )
    const activity = await this._context.doActivity({
      to: actor.id,
      type: 'Follow',
      object: 'https://www.w3.org/ns/activitystreams#Public'
    })
    this._context.logger.info(
      { relay: actor.id, activity: activity.id },
      'Saving follow for later'
    )
    await this.#setFollowActivity(actor, activity)
  }

  async #unfollowRelay (actor) {
    this._context.logger.info(
      { relay: actor.id },
      'Unfollowing relay'
    )
    let activityId
    try {
      activityId = await this.#getFollowActivity(actor)
      this._context.logger.info(
        { relay: actor.id, activityId },
        'Follow activity found when unfollowing relay'
      )
    } catch (err) {
      this._context.logger.warn(
        { relay: actor.id },
        'No follow activity found when unfollowing relay'
      )
    }
    const undo = {
      to: actor.id,
      type: 'Undo',
      object: {
        type: 'Follow',
        actor: this._context.botActorId,
        object: 'https://www.w3.org/ns/activitystreams#Public'
      }
    }
    if (activityId) {
      undo.object.id = activityId
    }
    await this._context.doActivity(undo)
    this._context.logger.info(
      { relay: actor.id },
      'Clearing follow data'
    )
    await this._context.removeFollowingUnsafe(actor)
    await this.#deleteFollowActivity(actor)
  }

  async #handleAccept (activity) {
    const actor = activity.actor?.first
    const activityId = await this.#getFollowActivity(actor)
    if (activity.object?.first?.id === activityId) {
      this._context.logger.info(
        { accept: activity.id, follow: activityId },
        'Follow accepted'
      )
      await this._context.addFollowingUnsafe(activity.actor.first)
      return true
    } else {
      return false
    }
  }

  async #handleReject (activity) {
    const actor = activity.actor?.first
    const activityId = await this.#getFollowActivity(actor)
    if (activity.object?.first?.id === activityId) {
      this._context.logger.info(
        { accept: activity.id, follow: activityId },
        'Follow rejected'
      )
      return true
    } else {
      return false
    }
  }

  async #handleAnnounce (activity) {
    if (this.#relay.includes(activity.actor?.first?.id)) {
      await this._context.fanoutPublic(activity)
      return true
    }
    return false
  }

  async #setFollowActivity (actor, activity) {
    const key = `follow:${actor.id}`
    return await this._context.setData(key, activity.id)
  }

  async #getFollowActivity (actor) {
    const key = `follow:${actor.id}`
    return await this._context.getData(key)
  }

  async #deleteFollowActivity (actor) {
    const key = `follow:${actor.id}`
    return await this._context.deleteData(key)
  }

  async #hasFollowActivity (actor) {
    const key = `follow:${actor.id}`
    return await this._context.hasData(key)
  }
}
