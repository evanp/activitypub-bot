import Bot from '../bot.js'

export default class RelayClientBot extends Bot {
  #relay
  #unsubscribe

  constructor (username, relay, unsubscribe = null) {
    super(username)
    this.#relay = relay
    this.#unsubscribe = !!unsubscribe
  }

  get fullname () {
    return 'Relay Client Bot'
  }

  get description () {
    return 'A bot for subscribing to relays'
  }

  async initialize (context) {
    super.initialize(context)
    this._context.logger.info(
      { relay: this.#relay, unsubscribe: this.#unsubscribe },
      'Initialising relay client'
    )
    if (this.#unsubscribe) {
      if (await this._context.hasData(`follow:${this.#relay}`)) {
        await this.#unfollowRelay()
      }
    } else {
      if (!(await this._context.hasData(`follow:${this.#relay}`))) {
        await this.#followRelay()
      }
    }
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
    this._context.setData(`follow:${this.#relay}`, activity.id)
  }

  async #unfollowRelay () {
    const activityId = await this._context.getData(`follow:${this.#relay}`)
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
    this._context.setData(`follow:${this.#relay}`, null)
  }

  async actorOK (actorId, activity) {
    return (actorId === this.#relay && !this.#unsubscribe)
  }
}
