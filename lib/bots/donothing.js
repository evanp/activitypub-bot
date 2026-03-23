import Bot from '../bot.js'

const DEFAULT_FULLNAME = 'Do Nothing Bot'
const DEFAULT_DESCRIPTION = 'A bot that does nothing.'

export default class DoNothingBot extends Bot {
  constructor (username, options = {}) {
    super(username, {
      fullname: DEFAULT_FULLNAME,
      description: DEFAULT_DESCRIPTION,
      ...options
    })
  }
}
