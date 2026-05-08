import assert from 'node:assert'

const EXPIRY = 7 * 24 * 60 * 60 * 1000

export class EndpointCache {
  #connection
  #logger

  constructor (connection, logger) {
    assert.ok(connection)
    assert.equal(typeof connection, 'object')
    assert.ok(logger)
    assert.equal(typeof logger, 'object')
    this.#connection = connection
    this.#logger = logger
  }

  async get (actorId, name) {
    assert.ok(actorId)
    assert.equal(typeof actorId, 'string')
    assert.ok(name)
    assert.equal(typeof name, 'string')
    const [rows] = await this.#connection.query(
      `SELECT url, expiry FROM endpoint_cache
       WHERE actor_id = ? AND name = ?`,
      { replacements: [actorId, name] }
    )
    if (rows && rows.length > 0) {
      if (new Date(rows[0].expiry) > new Date()) {
        return rows[0].url
      } else {
        return null
      }
    }
    return null
  }

  async set (actorId, name, url) {
    assert.ok(actorId)
    assert.equal(typeof actorId, 'string')
    assert.ok(name)
    assert.equal(typeof name, 'string')
    assert.ok(url)
    assert.equal(typeof url, 'string')
    await this.#connection.query(
    `
    INSERT INTO endpoint_cache (actor_id, name, url, expiry)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (actor_id, name) DO UPDATE SET
    url = EXCLUDED.url,
    expiry = EXCLUDED.expiry,
    updated_at = CURRENT_TIMESTAMP
    `,
    { replacements: [actorId, name, url, new Date(Date.now() + EXPIRY)] }
    )
  }
}
