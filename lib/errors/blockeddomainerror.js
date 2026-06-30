export class BlockedDomainError extends Error {
  constructor (message, url, method) {
    super(message)
    this.name = 'BlockedDomainError'
    this.url = url
    this.method = method
  }
}
