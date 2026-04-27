import Bot from '../bot.js'

const DEFAULT_NAME = 'FollowBackBot'
const DEFAULT_DESCRIPTION = 'A bot that follows you back'

export default class FollowBackBot extends Bot {
  #fullname
  #description

  constructor (username, options = {}) {
    super(username, options)
    this.#fullname = options.fullname || DEFAULT_NAME
    this.#description = options.description || DEFAULT_DESCRIPTION
  }

  async initialize (context) {
    await super.initialize(context)
    await this.#synchronizeFollowers()
  }

  get fullname () {
    return this.#fullname
  }

  get description () {
    return this.#description
  }

  async onFollow (actor, activity) {
    this._context.logger.info({ actorId: actor.id }, 'Following user back')
    await this._context.followActor(actor)
  }

  async onUndoFollow (actor, undoActivity, followActivity) {
    this._context.logger.info({ actorId: actor.id }, 'Unfollowing user back')
    await this._context.unfollowActor(actor)
  }

  async #synchronizeFollowers () {
    for await (const follower of this._context.followers()) {
      if (!await this._context.isFollowing(follower) &&
          !await this._context.isPendingFollowing(follower)) {
        await this._context.followActor(follower)
      }
    }
  }
}
