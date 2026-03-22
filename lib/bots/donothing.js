import Bot from '../bot.js'

const DEFAULT_FULLNAME = 'Do Nothing Bot'
const DEFAULT_DESCRIPTION = 'A bot that does nothing.'

export default class DoNothingBot extends Bot {
  #fullname
  #description

  constructor (username, options = {}) {
    super(username)
    this.#fullname = options.fullname || DEFAULT_FULLNAME
    this.#description = options.description || DEFAULT_DESCRIPTION
  }

  get fullname () {
    return this.#fullname
  }

  get description () {
    return this.#description
  }
}
