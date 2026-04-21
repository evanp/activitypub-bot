import Bot from '../bot.js'

const NS = 'https://www.w3.org/ns/activitystreams#'
const CREATE = `${NS}Create`

const DEFAULT_NAME = 'LitePubRelayClientBot'
const DEFAULT_DESCRIPTION = 'A LitePub relay client'

export default class LitePubRelayClientBot extends Bot {
  #relay
  #unsubscribe
  #relayActor
  #relayForwarding

  constructor (username, options = {}) {
    super(username, {
      fullname: DEFAULT_NAME,
      description: DEFAULT_DESCRIPTION,
      ...options
    })
    this.#relay = options.relay
    this.#unsubscribe = !!options.unsubscribe
    this.#relayForwarding = ('relayForwarding' in options)
      ? options.relayForwarding
      : true
  }

  get type () {
    return 'Application'
  }

  async initialize (context) {
    await super.initialize(context)
    this._context.logger.info(
      { relay: this.#relay, unsubscribe: this.#unsubscribe },
      'Initialising relay client'
    )

    this.#relayActor = await this._context.getObject(this.#relay)

    const haveFollowed =
      (await this._context.isFollowing(this.#relayActor)) ||
      (await this._context.isPendingFollowing(this.#relayActor))

    if (this.#unsubscribe && haveFollowed) {
      await this._context.unfollowActor(this.#relayActor)
    } else if (!haveFollowed) {
      await this._context.followActor(this.#relayActor)
    }
  }

  async onPublic (activity) {
    if (this.#relayForwarding &&
      await this._context.isFollowing(this.#relayActor) &&
      this._context.isLocal(activity.id) &&
      activity.type === CREATE &&
      activity.object?.first) {
      await this._context.announceObject(activity.object.first)
    }
  }
}
