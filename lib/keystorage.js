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
            CREATE TABLE IF NOT EXISTS new_keys (
                username varchar(512) PRIMARY KEY,
                public_key TEXT,
                private_key TEXT
            )
        `)
    try {
      await this.#connection.query(`
              INSERT OR IGNORE INTO new_keys (username, public_key, private_key)
              SELECT bot_id, public_key, private_key
              FROM keys
          `)
    } catch (error) {
      this.#logger.debug(
        { error, method: 'KeyStorage.initialize' },
        'failed to copy keys to new_keys table')
    }
  }

  async getPublicKey (username) {
    this.#logger.debug(
      { username, method: 'KeyStorage.getPublicKey' },
      'getting public key for bot')
    const [publicKey] = await this.#getKeys(username)
    return publicKey
  }

  async getPrivateKey (username) {
    this.#logger.debug(
      { username, method: 'KeyStorage.getPrivateKey' },
      'getting private key for bot')
    const [, privateKey] = await this.#getKeys(username)
    return privateKey
  }

  async #getKeys (username) {
    let privateKey
    let publicKey
    const [result] = await this.#connection.query(`
          SELECT public_key, private_key FROM new_keys WHERE username = ?
      `, { replacements: [username] })
    if (result.length > 0) {
      this.#logger.debug(
        { username, method: 'KeyStorage.#getKeys' },
        'found key for bot in database')
      publicKey = result[0].public_key
      privateKey = result[0].private_key
    } else {
      this.#logger.debug(
        { username, method: 'KeyStorage.#getKeys' },
        'no key for bot, generating new key'
      );
      [publicKey, privateKey] = await this.#newKeyPair(username)
      this.#logger.debug(
        { username, method: 'KeyStorage.#getKeys' },
        'saving new keypair to database'
      )
      await this.#saveKeyPair(username, publicKey, privateKey)
    }
    this.#logger.debug({
      username,
      method: 'KeyStorage.#getKeys',
      publicKeyHash: this.#hasher.humanize(publicKey),
      privateKeyHash: this.#hasher.humanize(privateKey)
    })
    return [publicKey, privateKey]
  }

  async #newKeyPair (username) {
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
    return [publicKey, privateKey]
  }

  async #saveKeyPair (username, publicKey, privateKey) {
    await this.#connection.query(`
        INSERT INTO new_keys (username, public_key, private_key) VALUES (?, ?, ?)
      `, { replacements: [username, publicKey, privateKey] })
  }
}
