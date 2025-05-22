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
    this._context.logger.info({ object: object.id, attributedTo, wf }, 'received mention')
    const content = (wf) ? `@${wf} OK` : 'OK'
    const reply = await this._context.sendReply(content, object)
    this._context.logger.info({
      reply: reply.id,
      content,
      inReplyTo: reply.inReplyTo.id
    }, 'sent reply')
  }
}
