export class NoSuchObjectError extends Error {
  constructor (id) {
    const message = `No such object: ${id}`
    super(message)
    this.name = 'NoSuchObjectError'
  }
}
