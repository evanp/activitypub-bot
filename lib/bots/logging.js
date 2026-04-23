import Bot from '../bot.js'

const DEFAULT_FULLNAME = 'Logging Bot'
const DEFAULT_DESCRIPTION = 'A bot that logs callback events.'

export default class LoggingBot extends Bot {
  constructor (username, options = {}) {
    super(username, {
      fullname: DEFAULT_FULLNAME,
      description: DEFAULT_DESCRIPTION,
      ...options
    })
  }

  async onMention (object, activity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        object: await object.export(),
        activity: await activity.export()
      },
      'onMention'
    )
  }

  async onFollow (actor, activity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        actor: await actor.export(),
        activity: await activity.export()
      },
      'onFollow'
    )
  }

  async onLike (object, activity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        object: await object.export(),
        activity: await activity.export()
      },
      'onLike'
    )
  }

  async onAnnounce (object, activity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        object: await object.export(),
        activity: await activity.export()
      },
      'onAnnounce'
    )
  }

  async onPublic (activity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        activity: await activity.export()
      },
      'onPublic'
    )
  }

  async actorOK (actorId, activity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        actorId,
        activity: await activity.export()
      },
      'actorOK'
    )
    return false
  }

  async handleActivity (activity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        activity: await activity.export()
      },
      'handleActivity'
    )
    return false
  }

  async onUndoFollow (actor, undoActivity, followActivity) {
    this._context.logger.debug(
      {
        class: this.constructor.name,
        actor: await actor.export(),
        undoActivity: await undoActivity.export(),
        followActivity: await followActivity.export()
      },
      'onUndoFollow'
    )
  }
}
