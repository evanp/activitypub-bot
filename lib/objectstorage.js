import assert from 'node:assert'
import as2 from './activitystreams.js'
import { QueryTypes } from 'sequelize'

import { NoSuchObjectError } from './errors/nosuchobjecterror.js'

export class ObjectStorage {
  #connection = null
  static #MAX_ITEMS_PER_PAGE = 256
  static #PAGE_NOT_PRESENT = -1
  static #PAGE_INLINE = 0

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
      { replacements: [id, data], type: QueryTypes.INSERT }
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

  async getCollection (id, property) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.ok(property, 'property is required')
    const [totalItems, first, createdAt, updatedAt] = await this.#collectionInfo(
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
    const props = {
      '@context': context,
      id: `${id}/${property}`,
      type: 'OrderedCollection',
      totalItems,
      published: (new Date(createdAt)).toISOString(),
      updated: (new Date(updatedAt)).toISOString(),
      [inverse]: id
    }
    if (totalItems > 0) {
      if (totalItems <= ObjectStorage.#MAX_ITEMS_PER_PAGE) {
        props.orderedItems = await this.#allItems(id, property)
      } else {
        props.first = `${id}/${property}/${first}`
        props.last = `${id}/${property}/1`
      }
    }
    const collection = await as2.import(props)
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

    let orderedItems = []

    const rows = await this.#connection.query(
      'SELECT item FROM pages WHERE id = ? AND property = ? and page = ? ORDER BY createdAt DESC, item DESC',
      { replacements: [id, property, page] }
    )

    if (rows[0].length > 0) {
      orderedItems = rows[0].map((row) => row.item)
    }

    const pageObject = await as2.import({
      id: `${id}/${property}/${page}`,
      type: 'OrderedCollectionPage',
      partOf: `${id}/${property}`,
      next: page === 1 ? null : `${id}/${property}/${page - 1}`,
      prev: page === first ? null : `${id}/${property}/${page + 1}`,
      orderedItems
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
        { replacements: [id, property], type: QueryTypes.INSERT }
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

    const [, affectedRowCount] = await this.#connection.query(
      'INSERT INTO pages (id, property, item, page) VALUES (?, ?, ?, ?)',
      { replacements: [id, property, object.id, page], type: QueryTypes.INSERT }
    )

    if (affectedRowCount > 0) {
      await this.#connection.query(
        'UPDATE collections SET totalItems = totalItems + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND property = ?',
        { replacements: [affectedRowCount, id, property] }
      )
    }
  }

  async removeFromCollection (id, property, object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')

    const affectedRowCount = await this.#connection.query(
      'DELETE FROM pages WHERE id = ? AND property = ? AND item = ?',
      { replacements: [id, property, object.id], type: QueryTypes.BULKDELETE }
    )

    if (affectedRowCount > 0) {
      await this.#connection.query(
        'UPDATE collections SET totalItems = totalItems - ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND property = ?',
        { replacements: [affectedRowCount, id, property] }
      )
    }
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

  async getItemPage (id, property, object) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')
    assert.ok(object.id, 'object.id is required')
    assert.equal(typeof object.id, 'string', 'object.id must be a string')

    const rows = await this.#connection.query(
      `SELECT p.page, c.totalItems AS totalitems
      FROM pages p JOIN collections c
      ON p.id = c.id AND p.property = c.property
      WHERE p.id = ? AND p.property = ? AND p.item = ?`,
      {
        replacements: [id, property, object.id],
        type: QueryTypes.SELECT
      }
    )
    return (rows.length === 0)
      ? ObjectStorage.#PAGE_NOT_PRESENT
      : (rows[0].totalitems <= ObjectStorage.#MAX_ITEMS_PER_PAGE)
          ? ObjectStorage.#PAGE_INLINE
          : rows[0].page
  }

  async #collectionInfo (id, property) {
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    let totalItems = 0
    let first = 1
    let createdAt = null
    let updatedAt = null
    const row = await this.#connection.query(
      'SELECT first, totalItems as totalitems, createdAt AS createdat, updatedAt AS updatedat FROM collections WHERE id = ? AND property = ?',
      { replacements: [id, property] }
    )
    if (row[0].length > 0) {
      first = row[0][0].first
      createdAt = row[0][0].createdat
      updatedAt = row[0][0].updatedat
      totalItems = row[0][0].totalitems
    }
    assert.equal(typeof totalItems, 'number', 'totalItems must be a number')
    assert.ok(totalItems >= 0, 'totalItems must be greater than or equal to 0')
    assert.equal(typeof first, 'number', 'first must be a number')
    assert.ok(first >= 1, 'first must be greater than or equal to 1')
    return [totalItems, first, createdAt, updatedAt]
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
      'SELECT COUNT(*) AS count FROM pages WHERE id = ? AND property = ? AND page = ?',
      { replacements: [id, property, page] }
    )
    return Number(rows[0][0].count ?? 0)
  }

  async #allItems (id, property) {
    assert.ok(this.#connection, 'ObjectStorage not initialized')
    assert.ok(id, 'id is required')
    assert.equal(typeof id, 'string', 'id must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')

    const rows = await this.#connection.query(
      `SELECT item FROM pages
      WHERE id = ? AND property = ?
      ORDER BY page DESC, createdAt DESC, item DESC`,
      { replacements: [id, property], type: QueryTypes.SELECT }
    )

    return (rows.length > 0)
      ? rows.map((row) => row.item)
      : []
  }
}
