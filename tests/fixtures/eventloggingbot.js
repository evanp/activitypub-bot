import Bot from '../../lib/bot.js'

export default class EventLoggingBot extends Bot {
  #follows = new Map()
  #mentions = new Map()
  #likes = new Map()
  #publics = new Map()
  #dupes = new Map()
  #shares = new Map()

  get fullname () {
    return 'Event-logging bot'
  }

  get description () {
    return 'A bot that logs events that happen to it'
  }

  async onMention (object, activity) {
    this.#mentions.set(activity.id, activity)
  }

  async onFollow (actor, activity) {
    this.#follows.set(activity.id, activity)
  }

  async onLike (object, activity) {
    this.#likes.set(activity.id, activity)
  }

  async onPublic (activity) {
    if (this.#publics.has(activity.id)) {
      this.#dupes.set(activity.id, activity)
    } else {
      this.#publics.set(activity.id, activity)
    }
  }

  async onAnnounce (object, activity) {
    this.#shares.set(activity.id, activity)
  }

  get follows () {
    return this.#follows
  }

  get mentions () {
    return this.#mentions
  }

  get likes () {
    return this.#likes
  }

  get publics () {
    return this.#publics
  }

  get shares () {
    return this.#shares
  }

  get dupes () {
    return this.#dupes
  }
}
