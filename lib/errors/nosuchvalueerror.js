export class NoSuchValueError extends Error {
  constructor (username, key) {
    const message = `No such value ${key} for user ${username}`
    super(message)
    this.name = 'NoSuchValueError'
  }
}
