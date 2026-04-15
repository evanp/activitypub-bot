import Bot from '../bot.js'

const NS = 'https://www.w3.org/ns/activitystreams#'
const ACCEPT = `${NS}Accept`
const REJECT = `${NS}Reject`

export default class MastodonRelayClientBot extends Bot {
  #relay
  #unsubscribe

  constructor (username, options = {}) {
    super(username, options)
    this.#relay = options.relay
    this.#unsubscribe = !!options.unsubscribe
  }

  get fullname () {
    return 'Mastodon Relay Client Bot'
  }

  get description () {
    return 'A bot for subscribing to relays'
  }

  get key () {
    return `follow:${this.#relay}`
  }

  async initialize (context) {
    super.initialize(context)
    this._context.logger.info(
      { relay: this.#relay, unsubscribe: this.#unsubscribe },
      'Initialising relay client'
    )
    if (this.#unsubscribe) {
      if (await this._context.hasData(this.key)) {
        await this.#unfollowRelay()
      }
    } else {
      if (!(await this._context.hasData(this.key)) ||
        ((await this._context.getData(this.key)) == null)) {
        await this.#followRelay()
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
    } else {
      return false
    }
  }

  async actorOK (actorId, activity) {
    return (actorId === this.#relay && !this.#unsubscribe)
  }

  async #followRelay () {
    this._context.logger.info(
      { relay: this.#relay },
      'Following relay'
    )
    const activity = await this._context.doActivity({
      to: this.#relay,
      type: 'Follow',
      object: 'https://www.w3.org/ns/activitystreams#Public'
    })
    this._context.logger.info(
      { relay: this.#relay, activity: activity.id },
      'Saving follow for later'
    )
    this._context.setData(this.key, activity.id)
  }

  async #unfollowRelay () {
    const activityId = await this._context.getData(this.key)
    this._context.logger.info(
      { relay: this.#relay, activity: activityId },
      'Unfollowing relay'
    )
    await this._context.doActivity({
      to: this.#relay,
      type: 'Undo',
      object: {
        id: activityId,
        type: 'Follow',
        object: 'https://www.w3.org/ns/activitystreams#Public'
      }
    })
    this._context.logger.info(
      { relay: this.#relay },
      'Clearing follow data'
    )
    this._context.deleteData(this.key)
  }

  async #handleAccept (activity) {
    const activityId = await this._context.getData(this.key)
    if (activity.object?.first?.id === activityId) {
      this._context.logger.info(
        { accept: activity.id, follow: activityId },
        'Follow accepted'
      )
      return true
    } else {
      return false
    }
  }

  async #handleReject (activity) {
    const activityId = await this._context.getData(this.key)
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
}
