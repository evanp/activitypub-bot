import assert from 'node:assert'

import Bot from '../bot.js'

const NS = 'https://www.w3.org/ns/activitystreams#'
const CREATE = `${NS}Create`

const DEFAULT_NAME = 'LitePubRelayClientBot'
const DEFAULT_DESCRIPTION = 'A LitePub relay client'

export default class LitePubRelayClientBot extends Bot {
  #relay
  #relayForwarding

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
    super(username, {
      fullname: DEFAULT_NAME,
      description: DEFAULT_DESCRIPTION,
      ...options
    })
    this.#relay = Array.isArray(options.relay)
      ? options.relay
      : [options.relay]
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
      { relay: this.#relay },
      'Initialising relay client'
    )

    assert.ok(Array.isArray(this.#relay))

    const toFollow = new Set(this.#relay)

    for await (const actor of this._context.following()) {
      if (toFollow.has(actor.id)) {
        toFollow.delete(actor.id)
      } else {
        await this._context.unfollowActor(actor)
      }
    }

    for (const id of toFollow) {
      const actor = await this._context.getObject(id)
      await this._context.followActor(actor)
    }
  }

  async onPublic (activity) {
    if (this.#relayForwarding &&
      await this.#hasAnyFollower() &&
      this._context.isLocal(activity.id) &&
      activity.type === CREATE &&
      activity.object?.first) {
      await this._context.announceObject(activity.object.first)
    }
  }

  async #hasAnyFollower () {
    for await (const actor of this._context.followers()) {
      if (this.#relay.includes(actor.id)) {
        return true
      }
    }
    return false
  }
}
