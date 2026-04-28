import Bot from '../bot.js'

const DEFAULT_NAME = 'FollowBackBot'
const DEFAULT_DESCRIPTION = 'A bot that follows you back'

const NS = 'https://www.w3.org/ns/activitystreams#'
const FOLLOW = `${NS}Follow`

// 7-day default timeout

const DEFAULT_STALE_FOLLOW_TIMEOUT = 7 * 24 * 60 * 60 * 1000

export default class FollowBackBot extends Bot {
  #fullname
  #description
  #staleFollowTimeout

  constructor (username, options = {}) {
    super(username, options)
    this.#fullname = options.fullname || DEFAULT_NAME
    this.#description = options.description || DEFAULT_DESCRIPTION
    this.#staleFollowTimeout = ('staleFollowTimeout' in options)
      ? options.staleFollowTimeout
      : DEFAULT_STALE_FOLLOW_TIMEOUT
  }

  async initialize (context) {
    await super.initialize(context)
    await this.#undoStalePendingFollowing()
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
      try {
        if (!await this._context.isFollowing(follower) &&
          !await this._context.isPendingFollowing(follower)) {
          await this._context.followActor(follower)
          this._context.logger.info(
            {
              actorId: follower.id
            },
            'Synchronized a follower not yet followed'
          )
        }
      } catch (err) {
        this._context.logger.error(
          {
            err,
            follower: follower.id
          },
          'Error checking for followback; skipping'
        )
      }
    }
  }

  async #undoStalePendingFollowing () {
    const now = new Date()
    for await (const follow of this._context.pendingFollowing()) {
      try {
        const activity = await this._context.getObject(follow.id)
        if (activity.type === FOLLOW) {
          if (activity.published && (now - activity.published > this.#staleFollowTimeout)) {
            await this._context.unfollowActor(activity.object.first)
            this._context.logger.info(
              {
                actorId: activity.object.first?.id,
                published: activity.published
              },
              'Unfollowed stale actor'
            )
          }
        } else if (activity.inbox) {
          const actor = activity
          this._context.logger.warn(
            {
              actorId: actor.id
            },
            'actor incorrectly in pendingFollowing'
          )
          await this._context.unfollowActor(actor)
        }
      } catch (err) {
        this._context.logger.error(
          {
            err,
            activity: follow.id
          },
          'Error checking stale follow; skipping'
        )
      }
    }
  }
}
