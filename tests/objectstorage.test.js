import { describe, it, before, after } from 'node:test'
import as2 from '../lib/activitystreams.js'
import assert from 'node:assert'
import { ObjectStorage, NoSuchObjectError } from '../lib/objectstorage.js'
import { createMigratedTestConnection } from './utils/db.js'

const TEST_NOTE_BASE = 'https://objectstorage.test/users/objectstoragetest/note'
const DOC1_ID = `${TEST_NOTE_BASE}/1`
const DOC2_ID = `${TEST_NOTE_BASE}/2`
const DOC3_ID = `${TEST_NOTE_BASE}/3`

describe('ObjectStorage', async () => {
  let doc = null
  let doc2 = null
  let doc3 = null
  let connection = null
  let storage = null

  async function cleanup () {
    const pattern = `${TEST_NOTE_BASE}/%`
    await connection.query(
      'DELETE FROM pages WHERE id LIKE ? OR item LIKE ?',
      { replacements: [pattern, pattern] }
    )
    await connection.query(
      'DELETE FROM collections WHERE id LIKE ?',
      { replacements: [pattern] }
    )
    await connection.query(
      'DELETE FROM objects WHERE id LIKE ?',
      { replacements: [pattern] }
    )
  }

  before(async () => {
    doc = await as2.import({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: DOC1_ID,
      type: 'Note',
      name: 'test',
      content: 'test'
    })
    doc2 = await as2.import({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: DOC2_ID,
      type: 'Note',
      name: 'test',
      content: 'test',
      inReplyTo: doc.id
    })
    doc3 = await as2.import({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: DOC3_ID,
      type: 'Note',
      name: 'test',
      content: 'test'
    })
    connection = await createMigratedTestConnection()
    await cleanup()
  })
  after(async () => {
    await cleanup()
    await connection.close()
    connection = null
    storage = null
  })
  it('can initialize', async () => {
    storage = new ObjectStorage(connection)
  })
  it('can create a new object', async () => {
    await storage.create(doc)
  })
  it('can read a created object', async () => {
    await storage.read(doc.id)
  })
  it('can update a created object', async () => {
    const doc2 = await as2.import({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: DOC1_ID,
      type: 'Note',
      name: 'test2',
      content: 'test2'
    })
    await storage.update(doc2)
    const read = await storage.read(doc2.id)
    assert.equal(read.name.get(), 'test2')
  })
  it('can delete a created object', async () => {
    await storage.delete(doc)
    try {
      await storage.read(doc.id)
      assert.fail('should not be able to read deleted object')
    } catch (err) {
      assert.ok(err instanceof NoSuchObjectError)
    }
  })
  it('can get a collection', async () => {
    const collection = await storage.getCollection(doc.id, 'replies')
    assert.equal(typeof (collection), 'object')
    assert.equal(typeof (collection.id), 'string')
    assert.equal(collection.id, `${doc.id}/replies`)
    assert.equal(collection.type, 'https://www.w3.org/ns/activitystreams#OrderedCollection')
    assert.equal(collection.totalItems, 0)
    assert.equal(collection.first.id, `${doc.id}/replies/1`)
    assert.equal(collection.last.id, `${doc.id}/replies/1`)
  })
  it('can get a collection page', async () => {
    const page = await storage.getCollectionPage(doc.id, 'replies', 1)
    assert.equal(typeof page, 'object')
    assert.equal(page.id, `${doc.id}/replies/1`)
    assert.equal(page.type, 'https://www.w3.org/ns/activitystreams#OrderedCollectionPage')
    assert.equal(page.partOf.id, `${doc.id}/replies`)
    assert.ok(!page.next)
    assert.ok(!page.prev)
    assert.ok(!page.items)
  })
  it('can add to a collection', async () => {
    await storage.addToCollection(doc.id, 'replies', doc2)
    const page = await storage.getCollectionPage(doc.id, 'replies', 1)
    assert.ok(Array.from(page.items).find(item => item.id === doc2.id))
  })
  it('can check collection membership', async () => {
    assert.strictEqual(true, await storage.isInCollection(doc.id, 'replies', doc2))
    assert.strictEqual(false, await storage.isInCollection(doc.id, 'replies', doc3))
  })
  it('can remove from a collection', async () => {
    await storage.removeFromCollection(doc.id, 'replies', doc2)
    const page = await storage.getCollectionPage(doc.id, 'replies', 1)
    assert.ok(!page.items)
  })
  it('can add many items to a collection', async () => {
    for (let i = 3; i < 103; i++) {
      const reply = await as2.import({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${TEST_NOTE_BASE}/${i}`,
        type: 'Note',
        name: 'test',
        content: 'test',
        inReplyTo: doc.id
      })
      await storage.addToCollection(doc.id, 'replies', reply)
    }
    const collection = await storage.getCollection(doc.id, 'replies')
    assert.equal(collection.totalItems, 100)
    assert.equal(collection.first.id, `${doc.id}/replies/5`)
    assert.equal(collection.last.id, `${doc.id}/replies/1`)
    const page = await storage.getCollectionPage(doc.id, 'replies', 3)
    assert.ok(page.next)
    // assert.ok(page.prev)
    assert.ok(page.items)
    const items = Array.from(page.items)
    assert.equal(items.length, 20)
    for (let i = 0; i < items.length; i++) {
      assert.ok(items[i])
      for (let j = i + 1; j < items.length; j++) {
        assert.ok(items[j])
        assert.ok(
          items[i].id > items[j].id,
          `item ${i} (${items[i].id}) <= item ${j} (${items[j].id})`
        )
      }
    }
  })
  it('can iterate over a collection', async () => {
    const seen = new Set()
    for await (const item of storage.items(doc.id, 'replies')) {
      assert.ok(!(item.id in seen))
      seen.add(item.id)
    }
    assert.strictEqual(seen.size, 100)
  })
})
