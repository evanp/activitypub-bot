export class ThrottleError extends Error {
  constructor (message, waitTime) {
    super(message)
    this.name = this.constructor.name
    this.waitTime = waitTime
  }
}
