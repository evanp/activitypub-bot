import { describe, it } from 'node:test'
import { ObjectCache } from '../lib/objectcache.js'
import assert from 'node:assert/strict'
import as2 from '../lib/activitystreams.js'

describe('ObjectCache', async () => {
  let cache = null
  const longTTL = 3600 * 1000
  const shortTTL = 300 * 1000
  const maxItems = 1000
  const makeObject = (num) =>
    as2.import({
      id: `https://example.com/${num}`,
      name: `Object ${num}`,
      type: 'Object',
      attributedTo: `https://example.com/user${num}`,
      to: 'https://www.w3.org/ns/activitystreams#Public'
    })
  const makeCollection = (num) =>
    as2.import({
      id: `https://example.com/collection${num}`,
      type: 'Collection',
      name: `Collection ${num}`,
      totalItems: 1
    })

  const object1 = await makeObject(1)
  const object2 = await makeObject(2)
  const object3 = await makeObject(3)
  const object4 = await makeObject(4)
  const object5 = await makeObject(5)
  const badid = 'https://example.com/badid'
  const badcoll = 'https://example.com/badcoll'
  const collection1 = await makeCollection(1)
  const collection2 = await makeCollection(2)
  const collection3 = await makeCollection(3)

  it('should be a class', async () => {
    assert.strictEqual(typeof ObjectCache, 'function')
  })

  it('can be instantiated', async () => {
    cache = new ObjectCache({ longTTL, shortTTL, maxItems })
    assert.strictEqual(typeof cache, 'object')
  })

  it('can be initialized', async () => {
    try {
      await cache.initialize()
      assert.ok(true)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('returns undefined if not found', async () => {
    try {
      const value = await cache.get(badid)
      assert.strictEqual(value, undefined)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('can save', async () => {
    try {
      await cache.save(object1)
      const dupe = await cache.get(object1.id)
      assert.strictEqual(dupe.id, object1.id)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('can saveReceived', async () => {
    try {
      await cache.saveReceived(object2)
      const dupe = await cache.get(object2.id)
      assert.strictEqual(dupe.id, object2.id)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('can clear', async () => {
    try {
      await cache.save(object3)
      await cache.clear(object3)
      const dupe = await cache.get(object3.id)
      assert.strictEqual(dupe, undefined)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('fails membership for unknown collection', async () => {
    try {
      const flag = await cache.isMember(collection3, badid)
      assert.strictEqual(flag, undefined)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('fails membership for unknown object', async () => {
    try {
      const flag = await cache.isMember(badcoll, object4)
      assert.strictEqual(flag, undefined)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('can saveMembership', async () => {
    try {
      await cache.saveMembership(collection1, object4)
      const flag = await cache.isMember(collection1, object4)
      assert.ok(flag)
    } catch (error) {
      assert.fail(error)
    }
  })

  it('can saveMembershipReceived', async () => {
    try {
      await cache.saveMembershipReceived(collection2, object5)
      const flag = await cache.isMember(collection2, object5)
      assert.ok(flag)
    } catch (error) {
      assert.fail(error)
    }
  })
})
