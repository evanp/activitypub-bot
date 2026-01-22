import Bot from '../bot.js'

export default class OKBot extends Bot {
  get fullname () {
    return 'OK Bot'
  }

  get description () {
    return 'A bot that says "OK" when mentioned.'
  }

  async onMention (object, activity) {
    this._context.logger.debug(
      { object: object.id, activity: activity.id },
      'bot mentioned'
    )
    if (!await this.hasSeen(object)) {
      this._context.logger.debug(
        { object: object.id },
        'not previously seen'
      )
      const attributedTo =
        object.attributedTo?.first.id ||
        activity.actor?.first.id
      this._context.logger.debug(
        { object: object.id, attributedTo: attributedTo },
        'attributed to'
      )
      const wf = await this._context.toWebfinger(attributedTo)
      const content = (wf) ? `@${wf} OK` : 'OK'
      this._context.logger.info({
        object: object.id,
        attributedTo,
        wf,
        content
      }, 'sending reply')
      const reply = await this._context.sendReply(content, object)
      this._context.logger.info({
        reply: reply.id,
        content,
        inReplyTo: reply.inReplyTo.id
      }, 'sent reply')
      await this.setSeen(object)
    }
  }

  async hasSeen (object) {
    const id = object.id
    const key = `seen:${id}`
    return this._context.hasData(key)
  }

  async setSeen (object) {
    const id = object.id
    const key = `seen:${id}`
    return this._context.setData(key, true)
  }
}
