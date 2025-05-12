import Bot from '../bot.js'

export default class OKBot extends Bot {
  get fullname () {
    return 'OK Bot'
  }

  get description () {
    return 'A bot that says "OK" when mentioned.'
  }

  async onMention (object, activity) {
    const attributedTo =
      object.attributedTo?.first.id ||
      activity.actor?.first.id
    const wf = await this._context.toWebfinger(attributedTo)
    const content = (wf) ? `${wf} OK` : 'OK'
    await this._context.sendReply(content, object)
  }
}
