import assert from 'node:assert'

import as2 from './activitystreams.js'

const SEC_NS = 'https://w3id.org/security#'
const NS = 'https://www.w3.org/ns/activitystreams#'
const KEY_TYPES = [SEC_NS + 'Key', SEC_NS + 'CryptographicKey']
const COLLECTION_TYPES =
  [NS + 'Collection', NS + 'CollectionPage', NS + 'OrderedCollection', NS + 'OrderedCollectionPage']

export class RemoteObjectCache {
  #connection
  #logger
  constructor (connection, logger) {
    assert.ok(connection)
    assert.ok(logger)
    this.#connection = connection
    this.#logger = logger
  }

  async get (id, username) {
    assert.ok(id)
    assert.strictEqual(typeof id, 'string')
    assert.ok(username)
    assert.strictEqual(typeof username, 'string')

    let result

    const [rows] = await this.#connection.query(
      `SELECT last_modified, etag, expiry, data
      FROM remote_object_cache
      WHERE id = ? AND username = ?`,
      { replacements: [id, username] })

    if (rows.length === 0) {
      result = null
    } else {
      result = {
        expiry: new Date(rows[0].expiry),
        lastModified: rows[0].last_modified
          ? new Date(rows[0].last_modified)
          : null,
        etag: rows[0].etag,
        object: JSON.parse(rows[0].data)
      }
    }

    assert.ok(
      result === null ||
      (
        typeof result === 'object' &&
       'expiry' in result &&
       'lastModified' in result &&
       'etag' in result &&
       'object' in result
      )
    )

    return result
  }

  async set (id, username, object, headers) {
    assert.ok(id)
    assert.strictEqual(typeof id, 'string')
    assert.ok(username)
    assert.strictEqual(typeof username, 'string')
    assert.ok(object)
    assert.strictEqual(typeof object, 'object')
    assert.ok(headers)
    assert.strictEqual(typeof headers, 'object')
    assert.ok(typeof headers.get === 'function')

    const cacheControl = headers.get('cache-control')
    if (cacheControl && cacheControl.includes('no-store')) {
      return
    }

    const expiry = await this.#getExpiry(object, headers)
    const lastModified = headers.get('last-modified')
    const etag = headers.get('etag')

    await this.#connection.query(
      `INSERT INTO remote_object_cache
      (id, username, last_modified, etag, expiry, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id, username)
      DO UPDATE
      SET last_modified = EXCLUDED.last_modified,
      etag = EXCLUDED.etag,
      expiry = EXCLUDED.expiry,
      data = EXCLUDED.data,
      updated_at = CURRENT_TIMESTAMP
      `,
      { replacements: [id, username, lastModified, etag, expiry, JSON.stringify(object)] }
    )
  }

  async #getExpiry (object, headers) {
    assert.ok(object)
    assert.strictEqual(typeof object, 'object')
    assert.ok(headers)
    assert.strictEqual(typeof headers, 'object')
    assert.ok(typeof headers.get === 'function')

    let expiry = this.#getExpiryFromHeaders(headers)
    if (!expiry) {
      expiry = await this.#getExpiryFromObject(object)
    }
    return expiry
  }

  #getExpiryFromHeaders (headers) {
    assert.ok(headers)
    assert.strictEqual(typeof headers, 'object')
    assert.ok(typeof headers.get === 'function')

    const cacheControl = headers.get('cache-control')
    if (cacheControl) {
      if (cacheControl.includes('no-cache')) {
        return new Date(Date.now() - 1)
      } else if (cacheControl.includes('max-age')) {
        const match = cacheControl.match(/max-age=(\d+)/)
        if (match) {
          return new Date(Date.now() + parseInt(match[1], 10) * 1000)
        }
      }
    }
    if (headers.has('expires')) {
      return new Date(headers.get('expires'))
    }
    return null
  }

  async #getExpiryFromObject (object) {
    assert.ok(object)
    assert.strictEqual(typeof object, 'object')
    const as2obj = await as2.import(object)
    let offset
    if (as2obj.isActivity()) {
      offset = 24 * 60 * 60 * 1000
    } else if (as2obj.inbox) {
      offset = 30 * 60 * 1000
    } else if (KEY_TYPES.includes(as2obj.type)) {
      offset = -1000
    } else if (COLLECTION_TYPES.includes(as2obj.type)) {
      offset = -1000
    } else {
      offset = 5 * 60 * 1000
    }
    return new Date(Date.now() + offset)
  }
}
