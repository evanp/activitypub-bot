import Bot from '../../lib/bot.js'

class StartupBot extends Bot {
  #fullname = 'Before network initialization'

  get fullname () {
    return this.#fullname
  }

  async initializeNetwork () {
    this.#fullname = 'Network initialized'
  }
}

export default {
  startupbot: new StartupBot('startupbot')
}
