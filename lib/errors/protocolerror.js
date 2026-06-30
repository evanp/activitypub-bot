export class ProtocolError extends Error {
  constructor (url) {
    super(`URL ${url} uses a disallowed protocol`)
    this.name = 'ProtocolError'
    this.url = url
  }
}
