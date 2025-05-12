import Bot from '../bot.js'

export default class DoNothingBot extends Bot {
  get fullname () {
    return 'Do Nothing Bot'
  }

  get description () {
    return 'A bot that does nothing.'
  }
}
