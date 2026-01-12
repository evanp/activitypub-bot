const SEC_NS = 'https://w3id.org/security#'

export class RemoteKeyStorage {
  #client = null
  #connection = null
  #logger = null
  constructor (client, connection, logger) {
    this.#client = client
    this.#connection = connection
    this.#logger = logger.child({ class: this.constructor.name })
  }

  async getPublicKey (id, useCache = true) {
    this.debug(`getPublicKey(${id})`)
    if (useCache) {
      this.debug('using cache')
      const cached = await this.#getCachedPublicKey(id)
      if (cached) {
        this.debug(`getPublicKey(${id}) - cached`)
        return cached
      }
    } else {
      this.debug('skipping cache')
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
      'SELECT publicKeyPem, owner FROM new_remotekeys WHERE id = ?',
      { replacements: [id] }
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
      const publicKey = response.get(SEC_NS + 'publicKey').first
      if (publicKey) {
        owner = publicKey.get(SEC_NS + 'owner')?.first?.id
        publicKeyPem = publicKey.get(SEC_NS + 'publicKeyPem')?.first
      }
    }
    if (!owner || !publicKeyPem) {
      return null
    }
    return { owner, publicKeyPem }
  }

  async #cachePublicKey (id, owner, publicKeyPem) {
    await this.#connection.query(
      'INSERT INTO new_remotekeys (id, owner, publicKeyPem) VALUES (?, ?, ?) ' + ' ON CONFLICT(id) DO UPDATE ' +
      'SET owner=excluded.owner, publicKeyPem = excluded.publicKeyPem;',
      { replacements: [id, owner, publicKeyPem] }
    )
  }

  debug (...args) {
    if (this.#logger) {
      this.#logger.debug(...args)
    }
  }
}
