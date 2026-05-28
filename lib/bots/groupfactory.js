import assert from 'node:assert'

import BotFactory from '../botfactory.js'
import GroupBot from './group.js'

const USERNAME_PATTERN = /^[a-z0-9]{1,64}$/

export default class GroupBotFactory extends BotFactory {
  #options

  constructor (options = {}) {
    super()
    this.#options = options
  }

  async canCreate (username) {
    return USERNAME_PATTERN.test(username)
  }

  async create (username) {
    assert.ok(username)
    assert.ok(username.match(USERNAME_PATTERN))
    const bot = new GroupBot(username, this.#options)
    await bot.initialize(await this._context.duplicate(username))
    return bot
  }
}
