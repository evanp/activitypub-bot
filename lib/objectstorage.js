import assert from 'node:assert'
import as2 from './activitystreams.js'

export class NoSuchObjectError extends Error {
  constructor (id) {
    const message = `No such object: ${id}`
    super(message)
    this.name = 'NoSuchObjectError'
  }
}

export class ObjectStorage {
  #connection = null
  static #MAX_ITEMS_PER_PAGE = 20

  constructor (connection) {
    this.#connection = connection
  }

  async create (object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(object, 'object is required')
    assert.ok(object.id, 'object.id is required')
    const id = object.id
    const data = await object.write()
    assert.ok(data, 'object is required')
    assert.ok(typeof data === 'string', 'data must be a string')
    await this.#connection.query(
      'INSERT INTO objects (id, data) VALUES (?, ?)',
      { replacements: [id, data] }
    )
  }

  async read (id) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    const data = await this.#connection.query(
      'SELECT data FROM objects WHERE id = ?',
      { replacements: [id] }
    )
    if (data[0].length === 0) {
      throw new NoSuchObjectError(id)
    }
    return await as2.import(JSON.parse(data[0][0].data))
  }

  async update (object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(object, 'object is required')
    assert.ok(object.id, 'object.id is required')
    const id = object.id
    const data = await object.write()
    assert.ok(data, 'object is required')
    assert.ok(typeof data === 'string', 'data must be a string')
    await this.#connection.query(
      'UPDATE objects SET data = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      { replacements: [data, id] }
    )
  }

  async delete (object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(object, 'object is required')
    assert.ok(object.id, 'object.id is required')
    const id = object.id
    await this.#connection.query('DELETE FROM objects WHERE id = ?', {
      replacements: [id]
    })
  }

  async #collectionInfo (id, property) {
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    let totalItems = 0
    let first = 1
    let createdAt = null
    const row = await this.#connection.query(
      'SELECT first, createdAt FROM collections WHERE id = ? AND property = ?',
      { replacements: [id, property] }
    )
    if (row[0].length > 0) {
      first = row[0][0].first
      createdAt = row[0][0].createdAt
    }
    const count = await this.#connection.query(
      'SELECT COUNT(*) FROM pages WHERE id = ? AND property = ?',
      { replacements: [id, property] }
    )
    if (count[0].length > 0) {
      totalItems = count[0][0]['COUNT(*)']
    }
    assert.equal(typeof totalItems, 'number', 'totalItems must be a number')
    assert.ok(totalItems >= 0, 'totalItems must be greater than or equal to 0')
    assert.equal(typeof first, 'number', 'first must be a number')
    assert.ok(first >= 1, 'first must be greater than or equal to 1')
    return [totalItems, first, createdAt]
  }

  async getCollection (id, property) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.ok(property, 'property is required')
    const [totalItems, first, createdAt] = await this.#collectionInfo(
      id,
      property
    )
    const context = [
      'https://www.w3.org/ns/activitystreams'
    ]
    if (property === 'thread') {
      context.push('https://purl.archive.org/socialweb/thread/1.0')
    } else {
      context.push('https://w3id.org/fep/5711')
    }
    const inverse = (property === 'thread') ? 'root' : `${property}Of`
    const collection = await as2.import({
      '@context': context,
      id: `${id}/${property}`,
      type: 'OrderedCollection',
      totalItems,
      first: `${id}/${property}/${first}`,
      last: `${id}/${property}/1`,
      published: createdAt,
      [inverse]: id
    })
    assert.ok(collection, 'collection is required')
    assert.equal(typeof collection, 'object', 'collection must be an object')
    return collection
  }

  async getCollectionPage (id, property, page) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(page, 'pageNo is required')
    assert.equal(typeof page, 'number', 'page must be a number')
    assert.ok(page >= 1, 'page must be greater than or equal to 1')

    const [, first] = await this.#collectionInfo(
      id,
      property
    )

    if (page > first) {
      throw new NoSuchObjectError(`${id}/${property}/${page}`)
    }

    let items = []

    const rows = await this.#connection.query(
      'SELECT item FROM pages WHERE id = ? AND property = ? and page = ? ORDER BY createdAt DESC, item DESC',
      { replacements: [id, property, page] }
    )

    if (rows[0].length > 0) {
      items = rows[0].map((row) => row.item)
    }

    const pageObject = await as2.import({
      id: `${id}/${property}/${page}`,
      type: 'OrderedCollectionPage',
      partOf: `${id}/${property}`,
      next: page === 1 ? null : `${id}/${property}/${page - 1}`,
      prev: page === first ? null : `${id}/${property}/${page + 1}`,
      items
    })

    assert.ok(pageObject, 'collection is required')
    assert.equal(typeof pageObject, 'object', 'collection must be an object')

    return pageObject
  }

  async addToCollection (id, property, object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')

    const [, first, createdAt] = await this.#collectionInfo(
      id,
      property
    )

    if (createdAt === null) {
      await this.#connection.query(
        'INSERT INTO collections (id, property, first) VALUES (?, ?, 1)',
        { replacements: [id, property] }
      )
    }

    const count = await this.#itemCount(id, property, first)

    const page = count >= ObjectStorage.#MAX_ITEMS_PER_PAGE ? first + 1 : first

    if (page > first) {
      await this.#connection.query(
        'UPDATE collections SET first = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND property = ?',
        { replacements: [page, id, property] }
      )
    }

    await this.#connection.query(
      'INSERT INTO pages (id, property, item, page) VALUES (?, ?, ?, ?)',
      { replacements: [id, property, object.id, page] }
    )
  }

  async #itemCount (id, property, page) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(page, 'page is required')
    assert.equal(typeof page, 'number', 'page must be a number')
    assert.ok(page >= 1, 'page must be greater than or equal to 1')
    const rows = await this.#connection.query(
      'SELECT COUNT(*) FROM pages WHERE id = ? AND property = ? AND page = ?',
      { replacements: [id, property, page] }
    )
    return rows[0][0]['COUNT(*)']
  }

  async removeFromCollection (id, property, object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')

    await this.#connection.query(
      'DELETE FROM pages WHERE id = ? AND property = ? AND item = ?',
      { replacements: [id, property, object.id] }
    )
  }

  async isInCollection (id, property, object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')
    assert.ok(object.id, 'object.id is required')
    assert.equal(typeof object.id, 'string', 'object.id must be a string')
    const [result] = await this.#connection.query(
      `SELECT COUNT(*) as item_count
      FROM pages
      WHERE id = ? AND property = ? AND item = ?`,
      { replacements: [id, property, object.id] }
    )
    return result[0].item_count > 0
  }

  async * items (id, property) {
    assert.ok(id, 'username is required')
    assert.equal(typeof id, 'string', 'username must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')

    const result = await this.#connection.query(
      `SELECT item
      FROM pages
      WHERE id = ? AND property = ?
      ORDER BY page DESC, createdAt DESC, item DESC;`,
      { replacements: [id, property] }
    )
    for (const row of result[0]) {
      yield as2.import({ id: row.item })
    }
  }
}
