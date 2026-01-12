export default class BotFactory {
  #context

  async initialize (context) {
    this.#context = context
  }

  get _context () {
    return this.#context
  }

  async canCreate (username) {
    return false
  }

  async create (username) {
    const name = this.constructor.name
    throw new Error(`${name} class can't create bot named "${username}"`)
  }
}
