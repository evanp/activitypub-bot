import assert from 'node:assert'

export default class BotMaker {
  static async makeBot (bots, username) {
    assert.ok(bots)
    assert.ok(typeof bots === 'object')
    assert.ok(username)
    assert.ok(typeof username === 'string')

    let bot

    if (username in bots) {
      bot = bots[username]
    } else if ('*' in bots) {
      const factory = bots['*']
      if (await factory.canCreate(username)) {
        bot = await factory.create(username)
      }
    }

    return bot
  }
}
