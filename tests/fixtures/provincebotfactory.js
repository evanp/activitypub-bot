import BotFactory from '../../lib/botfactory.js'
import Bot from '../../lib/bot.js'

class ProvinceBot extends Bot {
  #name
  #type

  constructor (username, name, type) {
    super(username)
    this.#name = name
    this.#type = type
  }

  get fullname () {
    return this.#name
  }

  get description () {
    return `The ${this.#type} of ${this.#name}`
  }
}

export default class ProvinceBotFactory extends BotFactory {
  static #provinces = {
    ab: ['Alberta', 'province'],
    on: ['Ontario', 'province'],
    qc: ['Quebec', 'province'],
    bc: ['British Columbia', 'province'],
    mb: ['Manitoba', 'province'],
    sk: ['Saskatchewan', 'province'],
    nb: ['New Brunswick', 'province'],
    ns: ['Nova Scotia', 'province'],
    pe: ['Prince Edward Island', 'province'],
    nl: ['Newfoundland and Labrador', 'province'],
    nu: ['Nunavut', 'territory'],
    nt: ['Northwest Territories', 'territory'],
    yt: ['Yukon', 'territory']
  }

  async canCreate (username) {
    return (username in ProvinceBotFactory.#provinces)
  }

  async create (username) {
    if (!(username in ProvinceBotFactory.#provinces)) {
      throw new Error(`cannot create a bot with username ${username}`)
    }
    const [name, type] = ProvinceBotFactory.#provinces[username]
    const bot = new ProvinceBot(username, name, type)
    await bot.initialize(this._context)
    return bot
  }
}
