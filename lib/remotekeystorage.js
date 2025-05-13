const SEC_NS = 'https://w3id.org/security#'

export class RemoteKeyStorage {
  #client = null
  #connection = null
  #logger = null
  constructor (client, connection, logger = null) {
    this.#client = client
    this.#connection = connection
    this.#logger = logger
  }

  async initialize () {
    await this.#connection.query(
      `CREATE TABLE IF NOT EXISTS remotekeys (
        id TEXT PRIMARY KEY,
        owner TEXT,
        publicKeyPem TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    )
  }

  async getPublicKey (id) {
    this.debug(`getPublicKey(${id})`)
    const cached = await this.#getCachedPublicKey(id)
    if (cached) {
      this.debug(`getPublicKey(${id}) - cached`)
      return cached
    }
    const remote = await this.#getRemotePublicKey(id)
    if (!remote) {
      this.debug(`getPublicKey(${id}) - remote not found`)
      return null
    }
    await this.#cachePublicKey(id, remote.owner, remote.publicKeyPem)
    return remote
  }

  async #getCachedPublicKey (id) {
    this.debug(`#getCachedPublicKey(${id})`)
    const [result] = await this.#connection.query(
      'SELECT publicKeyPem, owner FROM remotekeys WHERE id = ?',
      [id]
    )
    if (result.length > 0) {
      this.debug(`cache hit for ${id}`)
      return {
        publicKeyPem: result[0].publicKeyPem,
        owner: result[0].owner
      }
    } else {
      this.debug(`cache miss for ${id}`)
      return null
    }
  }

  async #getRemotePublicKey (id) {
    this.debug(`#getRemotePublicKey(${id})`)
    const response = await this.#client.getKey(id)
    if (!response) {
      return null
    }
    this.debug(`getRemotePublicKey(${id}) - response: ${await response.id}`)
    let owner = null
    let publicKeyPem = null
    if (response.get(SEC_NS + 'publicKeyPem')) {
      this.debug(`getRemotePublicKey(${id}) - publicKeyPem`)
      owner = response.get(SEC_NS + 'owner')?.first?.id
      publicKeyPem = response.get(SEC_NS + 'publicKeyPem')?.first
    } else if (response.get(SEC_NS + 'publicKey')) {
      this.debug(`getRemotePublicKey(${id}) - publicKey`)
      owner = response.get(SEC_NS + 'publicKey').get(SEC_NS + 'owner')?.first?.id
      publicKeyPem = response.get(SEC_NS + 'publicKey').get(SEC_NS + 'publicKeyPem')?.first
    }
    if (!owner || !publicKeyPem) {
      return null
    }
    return { owner, publicKeyPem }
  }

  async #cachePublicKey (id, owner, publicKeyPem) {
    await this.#connection.query(
      'INSERT INTO remotekeys (id, owner, publicKeyPem) VALUES (?, ?, ?)',
      [id, owner, publicKeyPem]
    )
  }

  debug (...args) {
    if (this.#logger) {
      this.#logger.debug(...args)
    }
  }
}
