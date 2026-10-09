import Bot from '../bot.js'

export default class OKBot extends Bot {
  #content
  #language

  constructor (username, options = {}) {
    const says = ('content' in options)
      ? Array.isArray(options.content)
        ? 'random things'
        : `"${options.content}"`
      : '"OK"'
    options = {
      fullname: `${username} bot`,
      description: `A bot that says ${says} when mentioned.`,
      ...options
    }
    super(username, options)
    this.#content = ('content' in options)
      ? (Array.isArray(options.content))
          ? options.content
          : [options.content]
      : ['OK']
    this.#language = ('language' in options)
      ? options.language
      : null
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
        { object: object.id, attributedTo },
        'attributed to'
      )
      const wf = await this._context.toWebfinger(attributedTo)
      const response = this.#response()
      const content = (wf) ? `@${wf} ${response}` : response
      this._context.logger.info({
        object: object.id,
        attributedTo,
        wf,
        content
      }, 'sending reply')

      const reply = await this._context.sendReply(content, object, this.#language)
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

  #response () {
    const idx = Math.floor(Math.random() * this.#content.length)
    return this.#content[idx]
  }
}
