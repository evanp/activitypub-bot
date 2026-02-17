import assert from 'node:assert'

export class NoSuchValueError extends Error {
  constructor (username, key) {
    const message = `No such value ${key} for user ${username}`
    super(message)
    this.name = 'NoSuchValueError'
  }
}

export class BotDataStorage {
  #connection = null

  constructor (connection) {
    this.#connection = connection
  }

  async terminate () {

  }

  async set (username, key, value) {
    assert.ok(this.#connection, 'BotDataStorage not initialized')
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(key, 'key is required')
    assert.equal(typeof key, 'string', 'key must be a string')
    await this.#connection.query(`
      INSERT INTO botdata (value, username, key) VALUES (?, ?, ?)
      ON CONFLICT (username, key) DO UPDATE
      SET value = EXCLUDED.value, updatedAt = CURRENT_TIMESTAMP`,
    { replacements: [JSON.stringify(value), username, key] }
    )
  }

  async get (username, key) {
    assert.ok(this.#connection, 'BotDataStorage not initialized')
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(key, 'key is required')
    assert.equal(typeof key, 'string', 'key must be a string')
    const rows = await this.#connection.query(`
      SELECT value FROM botdata WHERE username = ? AND key = ?`,
    { replacements: [username, key] }
    )
    if (rows[0].length === 0) {
      throw new NoSuchValueError(username, key)
    }
    return JSON.parse(rows[0][0].value)
  }

  async has (username, key) {
    assert.ok(this.#connection, 'BotDataStorage not initialized')
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(key, 'key is required')
    assert.equal(typeof key, 'string', 'key must be a string')
    const rows = await this.#connection.query(`
      SELECT count(*) as count FROM botdata WHERE username = ? AND key = ?`,
    { replacements: [username, key] }
    )
    return (rows[0][0].count > 0)
  }

  async delete (username, key) {
    assert.ok(this.#connection, 'BotDataStorage not initialized')
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(key, 'key is required')
    await this.#connection.query(`
      DELETE FROM botdata WHERE username = ? AND key = ?`,
    { replacements: [username, key] }
    )
  }
}
