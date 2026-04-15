import FollowBackBot from './followback.js'

const DEFAULT_FULLNAME = 'LitePub Relay Server Bot'
const DEFAULT_DESCRIPTION = 'Implements server side of LitePub relay.'

const NS = 'https://www.w3.org/ns/activitystreams#'
const ANNOUNCE = `${NS}Announce`
const APPLICATION = `${NS}Application`

export default class LitePubRelayServer extends FollowBackBot {
  #relayForwarding
  constructor (username, options = {}) {
    super(username, {
      fullname: DEFAULT_FULLNAME,
      description: DEFAULT_DESCRIPTION,
      ...options
    })
    this.#relayForwarding = ('relayForwarding' in options)
      ? options.relayForwarding
      : true
  }

  async onFollow (actor, activity) {
    await super.onFollow(actor, activity)
    if (!actor.id?.endsWith('/relay')) {
      this._context.logger.warn(
        { actor: actor.id },
        'LitePub relay follower id does not end with /relay'
      )
    }
    try {
      const actorFull = await this._context.getObject(actor.id)
      if (!this.#objectType(actorFull, APPLICATION)) {
        this._context.logger.warn(
          { actor: actorFull.id, actorType: actorFull.type },
          'LitePub relay follower is not an Application'
        )
      }
    } catch (err) {
      this._context.logger.warn(
        { err, actor: actor.id },
        'Error loading follower in LitePubRelayServer'
      )
    }
  }

  async handleActivity (activity) {
    this._context.logger.debug(
      { class: this.constructor.name, activity: activity.id },
      'handling activity'
    )
    if (this.#objectType(activity, ANNOUNCE) &&
        activity.actor?.first?.id &&
        activity.object?.first?.id &&
        await this._context.isFollower(activity.actor.first) &&
        this.#addressedToFollowers(activity)) {
      if (this.#relayForwarding) {
        this._context.logger.debug(
          {
            class: this.constructor.name,
            activity: activity.id,
            actor: activity.actor.first.id,
            object: activity.object.first.id
          },
          'sharing object from follower'
        )
        await this._context.announceObject(activity.object.first)
      }
      return true
    } else {
      return false
    }
  }

  #objectType (object, type) {
    return (Array.isArray(object.type) && object.type.includes(type)) ||
        (typeof object.type === 'string' && object.type === type)
  }

  #addressedToFollowers (activity) {
    const recipients = this.#getRecipientIds(activity)
    const followersId = this._context.getFollowersId()
    return recipients.includes(followersId)
  }

  #getRecipientIds (obj) {
    let r = []
    for (const prop of ['to', 'cc', 'audience']) {
      const val = obj.get(prop)
      if (val) {
        r = r.concat(Array.from(val))
      }
    }
    return r.map(obj => obj.id)
  }
}
