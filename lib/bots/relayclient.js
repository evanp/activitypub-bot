import Bot from '../bot.js'

export default class RelayClientBot extends Bot {
  #relay

  constructor (username, relay) {
    super(username)
    this.#relay = relay
  }

  get fullname () {
    return 'Relay Client Bot'
  }

  get description () {
    return 'A bot for subscribing to relays'
  }

  async initialize (context) {
    super.initialize(context)
    if (!(await this._context.hasData(`follow:${this.#relay}`))) {
      await this.#followRelay()
    }
  }

  async #followRelay () {
    const activity = await this._context.doActivity({
      to: this.#relay,
      type: 'Follow',
      object: 'https://www.w3.org/ns/activitystreams#Public'
    })
    this._context.setData(`follow:${this.#relay}`, activity.id)
  }

  async actorOK (actorId, activity) {
    return (actorId === this.#relay)
  }
}