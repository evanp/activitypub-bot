import crypto from 'node:crypto'

export class Digester {
  #logger
  constructor (logger) {
    this.#logger = logger.child({ class: this.constructor.name })
  }

  async digest (body) {
    const digest = crypto.createHash('sha256')
    digest.update(body)
    return `sha-256=${digest.digest('base64')}`
  }

  equals (digest1, digest2) {
    const [alg1, hash1] = digest1.split('=', 2)
    const [alg2, hash2] = digest2.split('=', 2)
    if (alg1.toLowerCase() !== alg2.toLowerCase()) {
      return false
    }
    return hash1 === hash2
  }
}
