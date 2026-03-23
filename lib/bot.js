const DEFAULT_FULLNAME = 'Bot'
const DEFAULT_DESCRIPTION = 'Default bot'

export default class Bot {
  #context = null
  #username = null
  #checkSignature
  #fullname
  #description
  #icon
  #image

  constructor (username, options = {}) {
    this.#username = username
    this.#checkSignature = ('checkSignature' in options)
      ? options.checkSignature
      : true
    this.#fullname = ('fullname' in options)
      ? options.fullname
      : DEFAULT_FULLNAME
    this.#description = ('description' in options)
      ? options.description
      : DEFAULT_DESCRIPTION
    this.#icon = ('icon' in options)
      ? options.icon
      : null
    this.#image = ('image' in options)
      ? options.image
      : null
  }

  async initialize (context) {
    if (context.botId !== this.#username) {
      throw new Error(`Mismatched context: ${context.botId} !== ${this.#username}`)
    }
    this.#context = context
  }

  get fullname () {
    return this.#fullname
  }

  get description () {
    return this.#description
  }

  get icon () {
    return this.#icon
  }

  get image () {
    return this.#image
  }

  get username () {
    return this.#username
  }

  get checkSignature () {
    return this.#checkSignature
  }

  get _context () {
    return this.#context
  }

  async onMention (object, activity) {
    ; // no-op
  }

  async onFollow (actor, activity) {
    ; // no-op
  }

  async onLike (object, activity) {
    ; // no-op
  }

  async onAnnounce (object, activity) {
    ; // no-op
  }

  async onPublic (activity) {
    ; // no-op
  }

  async actorOK (actorId, activity) {
    return false
  }

  async handleActivity (activity) {
    return false
  }

  async onUndoFollow (actor, undoActivity, followActivity) {
    ; // no-op
  }
}
