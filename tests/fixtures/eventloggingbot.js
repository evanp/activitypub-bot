import Bot from '../../lib/bot.js'

export default class EventLoggingBot extends Bot {
  #follows = new Map()
  #mentions = new Map()

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

  get follows () {
    return this.#follows
  }

  get mentions () {
    return this.#mentions
  }
}
