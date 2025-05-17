import { promisify } from 'util'
import crypto from 'node:crypto'
import HumanHasher from 'humanhash'
import assert from 'node:assert'

const generateKeyPair = promisify(crypto.generateKeyPair)

export class KeyStorage {
  #connection = null
  #logger = null
  #hasher = null
  constructor (connection, logger) {
    assert.ok(connection, 'connection is required')
    assert.ok(logger, 'logger is required')
    this.#connection = connection
    this.#logger = logger
    this.#hasher = new HumanHasher()
  }

  async initialize () {
    await this.#connection.query(`
            CREATE TABLE IF NOT EXISTS keys (
                bot_id TEXT PRIMARY KEY,
                public_key TEXT,
                private_key TEXT
            )
        `)
  }

  async getPublicKey (botId) {
    this.#logger.debug(
      { botId, method: 'KeyStorage.getPublicKey' },
      'getting public key for bot')
    const [publicKey] = await this.#getKeys(botId)
    return publicKey
  }

  async getPrivateKey (botId) {
    this.#logger.debug(
      { botId, method: 'KeyStorage.getPrivateKey' },
      'getting private key for bot')
    const [, privateKey] = await this.#getKeys(botId)
    return privateKey
  }

  async #getKeys (botId) {
    let privateKey
    let publicKey
    const [result] = await this.#connection.query(`
          SELECT public_key, private_key FROM keys WHERE bot_id = ?
      `, [botId])
    if (result.length > 0) {
      this.#logger.debug(
        { botId, method: 'KeyStorage.#getKeys' },
        'found key for bot in database')
      publicKey = result[0].public_key
      privateKey = result[0].private_key
    } else {
      this.#logger.debug(
        { botId, method: 'KeyStorage.#getKeys' },
        'no key for bot, generating new key'
      );
      [publicKey, privateKey] = await this.#newKeyPair(botId)
    }
    this.#logger.debug({
      botId,
      method: 'KeyStorage.#getKeys',
      publicKeyHash: this.#hasher.humanize(publicKey),
      privateKeyHash: this.#hasher.humanize(privateKey)
    })
    return [publicKey, privateKey]
  }

  async #newKeyPair (botId) {
    const { publicKey, privateKey } = await generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        },
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        }
      }
    )
    await this.#connection.query(`
        INSERT INTO keys (bot_id, public_key, private_key) VALUES (?, ?, ?)
      `, [botId, publicKey, privateKey])
    return [publicKey, privateKey]
  }
}
