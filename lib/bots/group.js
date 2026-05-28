import Bot from '../bot.js'

const DEFAULT_DESCRIPTION = 'An echo group'

export default class GroupBot extends Bot {
  constructor (username, options = {}) {
    if (typeof username !== 'string') {
      throw new Error('username must be a string')
    }
    if (typeof options !== 'object') {
      throw new Error('options must be an object')
    }
    super(username,
      {
        fullname: `${username} Group`,
        description: DEFAULT_DESCRIPTION,
        ...options
      })
  }

  get type () {
    return 'Group'
  }

  async onMention (object, activity) {
    const last = await this._context.getLastActivity('Announce', object)
    if (last) {
      this._context.logger.info(
        { object: object.id, activity: activity.id, last },
        'Skipping re-announce of activity that was previously announced'
      )
      return
    }
    await this._context.announceObject(object)
  }
}
