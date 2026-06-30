export class RecoverableError extends Error {
  delay
  constructor (message, delay = 1000) {
    super(message)
    this.name = this.constructor.name
    this.delay = delay
  }
}
