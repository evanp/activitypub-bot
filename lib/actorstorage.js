import AS2 from 'activitystrea.ms'
import as2 from './activitystreams.js'
import assert from 'node:assert'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'

export class ActorStorage {
  #connection = null
  #formatter = null
  static #MAX_ITEMS_PER_PAGE = 20
  constructor (connection, formatter) {
    this.#connection = connection
    this.#formatter = formatter
  }

  async getActor (username, props = {}) {
    assert.ok(username)
    assert.equal(typeof username, 'string')
    const type = ('type' in props)
      ? (Array.isArray(props.type))
          ? [...props.type, 'Service']
          : [props.type, 'Service']
      : ['Service']
    // XXX: spread props first so type is not overwritten
    return await as2.import({
      ...props,
      id: this.#formatter.format({ username }),
      type,
      preferredUsername: username,
      inbox: this.#formatter.format({ username, collection: 'inbox' }),
      outbox: this.#formatter.format({ username, collection: 'outbox' }),
      followers: this.#formatter.format({ username, collection: 'followers' }),
      following: this.#formatter.format({ username, collection: 'following' }),
      liked: this.#formatter.format({ username, collection: 'liked' }),
      to: 'as:Public'
    })
  }

  async getActorById (id) {
    assert.ok(id)
    assert.equal(typeof id, 'string')
    const username = this.#formatter.getUserName(id)
    return await this.getActor(username)
  }

  async getCollection (username, property) {
    assert.ok(username)
    assert.equal(typeof username, 'string')
    assert.ok(property)
    assert.equal(typeof property, 'string')
    const [totalItems, first, createdAt, updatedAt] =
      await this.#getCollectionInfo(
        username,
        property
      )
    return await as2.import({
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/fep/5711'
      ],
      id: this.#formatter.format({ username, collection: property }),
      type: 'OrderedCollection',
      attributedTo: this.#formatter.format({ username }),
      [`${property}Of`]: this.#formatter.format({ username }),
      to: 'as:Public',
      summaryMap: {
        en: 'The ' + property + ' collection for user ' + username
      },
      totalItems,
      first: this.#formatter.format({
        username,
        collection: property,
        page: first
      }),
      last: this.#formatter.format({ username, collection: property, page: 1 }),
      published: createdAt,
      updated: updatedAt
    })
  }

  async getCollectionPage (username, property, page) {
    assert.ok(username)
    assert.equal(typeof username, 'string')
    assert.ok(property)
    assert.equal(typeof property, 'string')
    assert.ok(page)
    assert.equal(typeof page, 'number')
    assert.ok(page > 0)
    const [, first] = await this.#getCollectionInfo(username, property)
    if (page > first) {
      throw new Error('page out of range')
    }
    const result = await this.#connection.query(
      `SELECT item
      FROM actorcollectionpage
      WHERE username = ? AND property = ? AND page = ?
      ORDER BY createdAt DESC, item DESC
      ;`,
      { replacements: [username, property, page] })
    const items = []
    for (const row of result[0]) {
      items.push(row.item)
    }
    return await as2.import({
      id: this.#formatter.format({ username, collection: property, page }),
      type: 'OrderedCollectionPage',
      partOf: this.#formatter.format({ username, collection: property }),
      attributedTo: this.#formatter.format({ username }),
      to: 'as:Public',
      summaryMap: {
        en: `Page ${page} of the ${property} collection for user ${username}`
      },
      next: (page === 1)
        ? null
        : this.#formatter.format({ username, collection: property, page: page - 1 }),
      prev: (page === first)
        ? null
        : this.#formatter.format({ username, collection: property, page: page + 1 }),
      items
    })
  }

  async addToCollection (username, property, object) {
    assert.ok(this.#connection, 'ActorStorage not initialized')
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')

    const [, first, createdAt] = await this.#getCollectionInfo(
      username,
      property
    )

    if (createdAt === null) {
      await this.#connection.query(
        `INSERT INTO actorcollection (username, property, first, totalItems)
         VALUES (?, ?, 1, 0)`,
        { replacements: [username, property] }
      )
    }

    const count = await this.#itemCount(username, property, first)

    const page = (count >= ActorStorage.#MAX_ITEMS_PER_PAGE)
      ? first + 1
      : first

    if (page > first) {
      await this.#connection.query(
        `UPDATE actorcollection
        SET first = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE username = ? AND property = ?`,
        { replacements: [page, username, property] }
      )
    }

    await this.#connection.query(
      `INSERT INTO actorcollectionpage (username, property, item, page)
      VALUES (?, ?, ?, ?)`,
      { replacements: [username, property, object.id, page] }
    )

    await this.#connection.query(
      `UPDATE actorcollection
      SET totalItems = totalItems + 1, updatedAt = CURRENT_TIMESTAMP
      WHERE username = ? AND property = ?`,
      { replacements: [username, property] }
    )
  }

  async removeFromCollection (username, property, object) {
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')

    if (!await this.isInCollection(username, property, object)) {
      return 0
    }

    await this.#connection.query(
      `DELETE FROM actorcollectionpage
      WHERE username = ? AND property = ? AND item = ?`,
      { replacements: [username, property, object.id] }
    )

    await this.#connection.query(
      `UPDATE actorcollection
      SET totalItems = totalItems - 1, updatedAt = CURRENT_TIMESTAMP
      WHERE username = ? AND property = ?`,
      { replacements: [username, property] }
    )

    return 1
  }

  async * items (username, property) {
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')

    const result = await this.#connection.query(
      `SELECT item
      FROM actorcollectionpage
      WHERE username = ? AND property = ?
      ORDER BY page DESC, createdAt DESC, item DESC;`,
      { replacements: [username, property] }
    )
    for (const row of result[0]) {
      yield as2.import({ id: row.item })
    }
  }

  async isInCollection (username, property, object) {
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')
    const [result] = await this.#connection.query(
      `SELECT COUNT(*) as item_count
      FROM actorcollectionpage
      WHERE username = ? AND property = ? AND item = ?`,
      { replacements: [username, property, object.id] }
    )
    return result[0].item_count > 0
  }

  async hasPage (username, property, page) {
    const [, first] = await this.#getCollectionInfo(
      username,
      property
    )
    return page <= first
  }

  async getUsernamesWith (property, object) {
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')
    const [result] = await this.#connection.query(
      `SELECT username
      FROM actorcollectionpage
      WHERE property = ? AND item = ?`,
      { replacements: [property, object.id] }
    )
    const usernames = []
    for (const row of result) {
      usernames.push(row.username)
    }
    return usernames
  }

  async getLastActivity (username, type, object) {
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(type, 'type is required')
    assert.equal(typeof type, 'string', 'type must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')
    assert.ok(object.id, 'object.id is required')
    assert.equal(typeof object.id, 'string', 'object.id must be a string')

    const [result] = await this.#connection.query(
      `SELECT activity_id
      FROM lastactivity
      WHERE username = ? AND type = ? and object_id = ?`,
      { replacements: [username, this.#clearNS(type), object.id] }
    )

    return (result.length > 0)
      ? result[0].activity_id
      : null
  }

  async clearLastActivity (username, type, object) {
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(type, 'type is required')
    assert.equal(typeof type, 'string', 'type must be a string')
    assert.ok(object, 'object is required')
    assert.equal(typeof object, 'object', 'object must be an object')
    assert.ok(object.id, 'object.id is required')
    assert.equal(typeof object.id, 'string', 'object.id must be a string')

    await this.#connection.query(
      `DELETE FROM lastactivity
      WHERE username = ? AND type = ? and object_id = ?`,
      { replacements: [username, this.#clearNS(type), object.id] }
    )
  }

  async setLastActivity (username, activity) {
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(activity, 'activity is required')
    assert.equal(typeof activity, 'object', 'activity must be an object')
    assert.ok(activity.id, 'activity.id is required')
    assert.equal(typeof activity.id, 'string', 'id must be a string')
    assert.ok(activity.type, 'activity.type is required')
    assert.equal(typeof activity.type, 'string', 'type must be a string')
    assert.ok(activity.object, 'activity.object is required')
    assert.equal(typeof activity.object, 'object', 'activity.object must be an object')
    assert.ok(activity.object.first.id, 'activity.object.id is required')
    assert.equal(typeof activity.object.first.id, 'string', 'activity.object.id must be a string')

    await this.#connection.query(
      `
        INSERT INTO lastactivity (username, type, object_id, activity_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT DO UPDATE
        SET activity_id = EXCLUDED.activity_id,
            updatedAt = CURRENT_TIMESTAMP
      `,
      { replacements: [
          username,
          this.#clearNS(activity.type),
          activity.object.first.id,
          activity.id
        ]
      }
    )
  }

  async #getCollectionInfo (username, property) {
    const [result] = await this.#connection.query(
      `SELECT first, totalItems, createdAt, updatedAt
      FROM actorcollection
      WHERE username = ? AND property = ?;`,
      { replacements: [username, property] }
    )
    if (result.length > 0) {
      const row = result[0]
      return [row.totalItems, row.first, row.createdAt, row.updatedAt]
    } else {
      return [0, 1, null, null]
    }
  }

  async #itemCount (username, property, page) {
    assert.ok(this.#connection, 'ActorStorage not initialized')
    assert.ok(username, 'username is required')
    assert.equal(typeof username, 'string', 'username must be a string')
    assert.ok(property, 'property is required')
    assert.equal(typeof property, 'string', 'property must be a string')
    assert.ok(page, 'page is required')
    assert.equal(typeof page, 'number', 'page must be a number')
    assert.ok(page >= 1, 'page must be greater than or equal to 1')
    const rows = await this.#connection.query(
      `SELECT COUNT(*) as item_count FROM actorcollectionpage
      WHERE username = ? AND property = ? AND page = ?`,
      { replacements: [username, property, page] }
    )
    return rows[0][0].item_count
  }

  #clearNS (type) {
    return (type.startsWith(AS2_NS))
      ? type.slice(AS2_NS.length)
      : type
  }
}
