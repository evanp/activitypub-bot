import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import { ObjectStorage } from '../lib/objectstorage.js'
import { NoSuchObjectError } from '../lib/errors/nosuchobjecterror.js'
import as2 from '../lib/activitystreams.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const MAX_PAGE_SIZE = 256
const LOCAL_HOST = 'local.objectstorage.test'
const TEST_NOTE_BASE = `https://${LOCAL_HOST}/users/objectstoragetest/note`
const DOC1_ID = `${TEST_NOTE_BASE}/1`
const DOC2_ID = `${TEST_NOTE_BASE}/2`
const DOC3_ID = `${TEST_NOTE_BASE}/3`

describe('ObjectStorage', async () => {
  let doc = null
  let doc2 = null
  let doc3 = null
  let connection = null
  let storage = null

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
    await cleanupTestData(connection, { localDomain: LOCAL_HOST })
  })
  after(async () => {
    await cleanupTestData(connection, { localDomain: LOCAL_HOST })
    await connection.close()
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
    const exported = await collection.export({ useOriginalContext: true })
    assert.strictEqual(exported.first, undefined)
    assert.strictEqual(exported.orderedItems, undefined)
  })
  for (const count of [0, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE + 1]) {
    it(`exports a collection with ${count} members using the inline threshold`, async () => {
      const id = `${TEST_NOTE_BASE}/inline-${count}`
      const ids = []
      for (let i = 0; i < count; i++) {
        const item = await as2.import({ id: `${TEST_NOTE_BASE}/inline/${count}/${String(i).padStart(3, '0')}`, type: 'Note' })
        ids.push(item.id)
        await storage.addToCollection(id, 'replies', item)
      }
      await connection.query(
        'UPDATE pages SET createdAt = ? WHERE id = ? AND property = ?',
        { replacements: ['2020-01-01T00:00:00Z', id, 'replies'] }
      )
      const exported = await (await storage.getCollection(id, 'replies')).export({ useOriginalContext: true })
      assert.strictEqual(exported.totalItems, count)
      assert.strictEqual(exported.items, undefined)
      if (count > MAX_PAGE_SIZE) {
        assert.strictEqual(typeof exported.first, 'string')
        assert.strictEqual(exported.orderedItems, undefined)
      } else {
        assert.strictEqual(exported.first, undefined)
        assert.deepStrictEqual(exported.orderedItems, count === 0 ? undefined : ids.reverse())
      }
    })
  }

  it('inlines all remaining members when a paginated collection shrinks to page size', async () => {
    const id = `${TEST_NOTE_BASE}/inline-shrink`
    const members = []
    for (let i = 0; i <= MAX_PAGE_SIZE; i++) {
      const member = await as2.import({ id: `${TEST_NOTE_BASE}/shrink/${String(i).padStart(3, '0')}`, type: 'Note' })
      members.push(member)
      await storage.addToCollection(id, 'replies', member)
    }
    await connection.query(
      'UPDATE pages SET createdAt = ? WHERE id = ? AND property = ?',
      { replacements: ['2020-01-01T00:00:00Z', id, 'replies'] }
    )
    await storage.removeFromCollection(id, 'replies', members.shift())
    const exported = await (await storage.getCollection(id, 'replies')).export({ useOriginalContext: true })
    assert.strictEqual(exported.totalItems, MAX_PAGE_SIZE)
    assert.strictEqual(exported.first, undefined)
    assert.deepStrictEqual(exported.orderedItems, members.map(member => member.id).reverse())
  })

  describe('getItemPage()', () => {
    const owner = `${TEST_NOTE_BASE}/seekitem`
    const property = 'replies'
    const members = []
    let absent

    before(async () => {
      absent = await as2.import({ id: `${TEST_NOTE_BASE}/seekitem-members/absent`, type: 'Note' })
      for (let i = 0; i < 2 * MAX_PAGE_SIZE + 1; i++) {
        const member = await as2.import({
          id: `${TEST_NOTE_BASE}/seekitem-members/${i}`,
          type: 'Note'
        })
        members.push(member)
        await storage.addToCollection(owner, property, member)
      }
    })

    it('returns -1 for an empty collection', async () => {
      assert.strictEqual(await storage.getItemPage(owner, 'shares', absent), -1)
    })

    it('returns -1 for a non-member of a paginated collection', async () => {
      assert.strictEqual(await storage.getItemPage(owner, property, absent), -1)
    })

    it('does not find a member in another collection property', async () => {
      await storage.addToCollection(owner, 'shares', absent)
      assert.strictEqual(await storage.getItemPage(owner, property, absent), -1)
      assert.strictEqual(await storage.getItemPage(owner, 'shares', members[0]), -1)
    })

    it('does not find a member under another owner', async () => {
      assert.strictEqual(await storage.getItemPage(`${TEST_NOTE_BASE}/seekitem-other`, property, members[0]), -1)
    })

    for (const [index, page] of [[0, 1], [MAX_PAGE_SIZE - 1, 1], [MAX_PAGE_SIZE, 2], [2 * MAX_PAGE_SIZE - 1, 2], [2 * MAX_PAGE_SIZE, 3]]) {
      it(`returns page ${page} for member ${index}`, async () => {
        assert.strictEqual(await storage.getItemPage(owner, property, members[index]), page)
        const exported = await (await storage.getCollectionPage(owner, property, page)).export()
        assert.ok(exported.orderedItems.includes(members[index].id))
      })
    }

    it('matches membership by id rather than object identity', async () => {
      const reference = await as2.import({ id: members[MAX_PAGE_SIZE].id })
      assert.strictEqual(await storage.getItemPage(owner, property, reference), 2)
    })

    it('returns -1 for a removed member', async () => {
      await storage.removeFromCollection(owner, property, members[1])
      assert.strictEqual(await storage.getItemPage(owner, property, members[1]), -1)
    })

    it('returns 0 when remaining members become inline, even from later pages', async () => {
      for (const member of members.slice(2, MAX_PAGE_SIZE + 2)) {
        await storage.removeFromCollection(owner, property, member)
      }
      const exported = await (await storage.getCollection(owner, property)).export()
      assert.strictEqual(exported.totalItems, MAX_PAGE_SIZE)
      assert.strictEqual(exported.first, undefined)
      for (const member of [members[0], members[2 * MAX_PAGE_SIZE]]) {
        assert.ok(exported.orderedItems.includes(member.id))
        assert.strictEqual(await storage.getItemPage(owner, property, member), 0)
      }
      assert.strictEqual(await storage.getItemPage(owner, property, members[1]), -1)
    })

    for (const count of [1, MAX_PAGE_SIZE]) {
      it(`returns 0 for members and -1 for non-members with ${count} inline items`, async () => {
        const inlineProperty = `seek-inline-${count}`
        for (const member of members.slice(0, count)) {
          await storage.addToCollection(owner, inlineProperty, member)
        }
        assert.strictEqual(await storage.getItemPage(owner, inlineProperty, members[0]), 0)
        assert.strictEqual(await storage.getItemPage(owner, inlineProperty, members[count - 1]), 0)
        assert.strictEqual(await storage.getItemPage(owner, inlineProperty, absent), -1)
      })
    }
  })

  it('can get a collection page', async () => {
    const page = await storage.getCollectionPage(doc.id, 'replies', 1)
    assert.equal(typeof page, 'object')
    assert.equal(page.id, `${doc.id}/replies/1`)
    assert.equal(page.type, 'https://www.w3.org/ns/activitystreams#OrderedCollectionPage')
    assert.equal(page.partOf.id, `${doc.id}/replies`)
    assert.ok(!page.next)
    assert.ok(!page.prev)
    assert.strictEqual(page.get('items')?.length ?? 0, 0)
    const exported = await page.export({ useOriginalContext: true })
    assert.strictEqual(exported.items, undefined)
    assert.deepStrictEqual(exported.orderedItems ?? [], [])
  })
  it('can add to a collection', async () => {
    await storage.addToCollection(doc.id, 'replies', doc2)
    const collection = await storage.getCollection(doc.id, 'replies')
    assert.ok(Array.from(collection.get('items') ?? []).find(item => item.id === doc2.id))
    const exported = await collection.export({ useOriginalContext: true })
    assert.strictEqual(exported.items, undefined)
    assert.deepStrictEqual(exported.orderedItems, [doc2.id])
  })
  it('can check collection membership', async () => {
    assert.strictEqual(true, await storage.isInCollection(doc.id, 'replies', doc2))
    assert.strictEqual(false, await storage.isInCollection(doc.id, 'replies', doc3))
  })
  it('can remove from a collection', async () => {
    await storage.removeFromCollection(doc.id, 'replies', doc2)
    const collection = await storage.getCollection(doc.id, 'replies')
    const exported = await collection.export({ useOriginalContext: true })
    assert.strictEqual(exported.first, undefined)
    assert.strictEqual(exported.orderedItems, undefined)
  })
  it('can add many items to a collection', async () => {
    for (let i = 3; i < 3 + (3 * MAX_PAGE_SIZE); i++) {
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
    assert.equal(collection.totalItems, 3 * MAX_PAGE_SIZE)
    assert.equal(collection.first.id, `${doc.id}/replies/3`)
    assert.equal(collection.last.id, `${doc.id}/replies/1`)
    const page = await storage.getCollectionPage(doc.id, 'replies', 2)
    assert.ok(page.next)
    assert.ok(page.get('items'))
    const items = Array.from(page.get('items'))
    assert.equal(items.length, MAX_PAGE_SIZE)
    const exported = await page.export({ useOriginalContext: true })
    assert.strictEqual(exported.items, undefined)
    assert.deepStrictEqual(exported.orderedItems, items.map(item => item.id))
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
    assert.strictEqual(seen.size, 3 * MAX_PAGE_SIZE)
  })

  for (const operation of ['add', 'remove', 'remove-last', 'remove-absent']) {
    it(`maintains collection timestamps on ${operation}`, async () => {
      const id = `${TEST_NOTE_BASE}/timestamps-${operation}`
      const oldTimestamp = '2020-01-01T00:00:00Z'
      await storage.addToCollection(id, 'replies', doc2)
      if (operation === 'remove') {
        await storage.addToCollection(id, 'replies', doc3)
      }
      await connection.query(
        'UPDATE collections SET createdAt = ?, updatedAt = ? WHERE id = ? AND property = ?',
        { replacements: [oldTimestamp, oldTimestamp, id, 'replies'] }
      )
      const before = await (await storage.getCollection(id, 'replies')).export()

      if (operation === 'add') {
        await storage.addToCollection(id, 'replies', doc3)
      } else {
        await storage.removeFromCollection(id, 'replies', operation === 'remove-absent' ? doc3 : doc2)
      }

      const after = await (await storage.getCollection(id, 'replies')).export()
      const expectedCount = operation === 'add' ? 2 : operation === 'remove-last' ? 0 : 1
      assert.strictEqual(after.totalItems, expectedCount)
      assert.strictEqual(after.first, before.first)
      assert.strictEqual(after.published, before.published)
      if (operation === 'remove-absent') {
        assert.strictEqual(after.updated, before.updated)
      } else {
        assert.ok(Date.parse(after.updated) > Date.parse(before.updated), 'updated must advance when membership changes')
      }
    })
  }
})
