import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { ActorStorage } from '../lib/actorstorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from '../lib/activitystreams.js'
import { createMigratedTestConnection } from './utils/db.js'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'

describe('ActorStorage', () => {
  let connection = null
  let storage = null
  let formatter = null
  let other = null
  let unfollowed = null
  before(async () => {
    connection = await createMigratedTestConnection()
    formatter = new UrlFormatter('https://activitypubbot.example')
    other = await as2.import({
      id: 'https://social.example/user/test2',
      type: 'Person'
    })
    unfollowed = await as2.import({
      id: 'https://social.example/user/test3',
      type: 'Person'
    })
  })
  after(async () => {
    await connection.close()
    connection = null
    formatter = null
  })
  it('can create an instance', () => {
    storage = new ActorStorage(connection, formatter)
    assert.ok(storage instanceof ActorStorage)
  })
  it('can initialize the storage', async () => {
  })
  it('can get an actor', async () => {
    const actor = await storage.getActor('test')
    assert.ok(actor)
    assert.ok(actor.id)
    assert.ok(actor.inbox)
    assert.ok(actor.outbox)
    assert.ok(actor.followers)
    assert.ok(actor.following)
    assert.ok(actor.liked)
    assert.strictEqual(actor.get('preferredUsername').first, 'test')
  })

  it('can get an actor by id', async () => {
    const actor = await storage.getActorById('https://activitypubbot.example/user/test')
    assert.ok(actor)
    assert.ok(actor.id)
    assert.ok(actor.inbox)
    assert.ok(actor.outbox)
    assert.ok(actor.followers)
    assert.ok(actor.following)
    assert.ok(actor.liked)
    assert.strictEqual(actor.get('preferredUsername').first, 'test')
  })
  it('can get an empty collection', async () => {
    const collection = await storage.getCollection('test', 'followers')
    assert.ok(collection)
    assert.strictEqual(collection.id, 'https://activitypubbot.example/user/test/followers')
    assert.strictEqual(collection.type, 'https://www.w3.org/ns/activitystreams#OrderedCollection')
    assert.strictEqual(collection.totalItems, 0)
    assert.ok(collection.first)
    assert.ok(collection.last)
  })
  it('can get an empty collection page', async () => {
    const page = await storage.getCollectionPage('test', 'followers', 1)
    assert.ok(page)
    assert.strictEqual(
      page.id,
      'https://activitypubbot.example/user/test/followers/1'
    )
    assert.strictEqual(page.type, 'https://www.w3.org/ns/activitystreams#OrderedCollectionPage')
    assert.strictEqual(
      page.partOf.id,
      'https://activitypubbot.example/user/test/followers'
    )
    assert.ok(!page.next)
    assert.ok(!page.prev)
  })
  it('can add to a collection', async () => {
    const collection = await storage.getCollection('test3', 'followers')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      'test3',
      'followers',
      other
    )
    const collection2 = await storage.getCollection('test3', 'followers')
    assert.strictEqual(collection2.totalItems, 1)
    const page = await storage.getCollectionPage('test3', 'followers', 1)
    assert.strictEqual(page.items.length, 1)
    assert.strictEqual(Array.from(page.items)[0].id, 'https://social.example/user/test2')
  })
  it('can remove from a collection', async () => {
    await storage.removeFromCollection(
      'test3',
      'followers',
      other
    )
    const collection2 = await storage.getCollection('test3', 'followers')
    assert.strictEqual(collection2.totalItems, 0)
    const page = await storage.getCollectionPage('test3', 'followers', 1)
    assert.ok(!page.items)
  })
  it('can add a lot of items a collection', async () => {
    for (let i = 0; i < 100; i++) {
      const other = await as2.import({
        id: `https://social.example/user/foo/note/${i}`,
        type: 'Note',
        content: `Hello World ${i}`
      })
      await storage.addToCollection(
        'test4',
        'liked',
        other
      )
    }
    const collection = await storage.getCollection('test4', 'liked')
    assert.strictEqual(collection.totalItems, 100)
    const page = await storage.getCollectionPage('test4', 'liked', 3)
    assert.strictEqual(page.items.length, 20)
    assert.strictEqual(page.next.id, 'https://activitypubbot.example/user/test4/liked/2')
  })
  it('can iterate over a collection', async () => {
    const seen = new Set()
    for await (const item of storage.items('test4', 'liked')) {
      assert.ok(!(item.id in seen))
      seen.add(item.id)
    }
    assert.strictEqual(seen.size, 100)
  })
  it('can add twice and remove once from a collection', async () => {
    const other = await as2.import({
      id: 'https://social.example/user/foo/note/200',
      type: 'Note',
      content: 'Hello World 200'
    })
    const other2 = await as2.import({
      id: 'https://social.example/user/foo/note/201',
      type: 'Note',
      content: 'Hello World 201'
    })
    const collection = await storage.getCollection('test5', 'liked')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      'test5',
      'liked',
      other
    )
    await storage.addToCollection(
      'test5',
      'liked',
      other2
    )
    const collection2 = await storage.getCollection('test5', 'liked')
    assert.strictEqual(collection2.totalItems, 2)
    await storage.removeFromCollection(
      'test5',
      'liked',
      other
    )
    const collection3 = await storage.getCollection('test5', 'liked')
    assert.strictEqual(collection3.totalItems, 1)
  })
  it('can check if something is in the collection', async () => {
    const other = await as2.import({
      id: 'https://social.example/user/foo/note/300',
      type: 'Note',
      content: 'Hello World 300'
    })
    const other2 = await as2.import({
      id: 'https://social.example/user/foo/note/301',
      type: 'Note',
      content: 'Hello World 301'
    })
    let collection = await storage.getCollection('test6', 'liked')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      'test6',
      'liked',
      other
    )
    collection = await storage.getCollection('test6', 'liked')
    assert.strictEqual(collection.totalItems, 1)
    assert.ok(await storage.isInCollection(
      'test6',
      'liked',
      other
    ))
    assert.ok(!await storage.isInCollection(
      'test6',
      'liked',
      other2
    ))
  })

  it('retains totalItems when we remove an absent object', async () => {
    const other = await as2.import({
      id: 'https://social.example/user/foo/note/400',
      type: 'Note',
      content: 'Hello World 400'
    })
    const other2 = await as2.import({
      id: 'https://social.example/user/foo/note/401',
      type: 'Note',
      content: 'Hello World 401'
    })
    const other3 = await as2.import({
      id: 'https://social.example/user/foo/note/402',
      type: 'Note',
      content: 'Hello World 402'
    })
    let collection = await storage.getCollection('test7', 'liked')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      'test7',
      'liked',
      other
    )
    await storage.addToCollection(
      'test7',
      'liked',
      other2
    )
    collection = await storage.getCollection('test7', 'liked')
    assert.strictEqual(collection.totalItems, 2)
    await storage.removeFromCollection(
      'test7',
      'liked',
      other3
    )
    collection = await storage.getCollection('test7', 'liked')
    assert.strictEqual(collection.totalItems, 2)
  })
  it('can get an actor with custom properties', async () => {
    const props = {
      name: 'Test User',
      summary: 'A test user',
      type: 'Person'
    }
    const actor = await storage.getActor('test8', props)
    assert.ok(actor)
    assert.ok(actor.id)
    assert.ok(actor.inbox)
    assert.ok(actor.outbox)
    assert.ok(actor.followers)
    assert.ok(actor.following)
    assert.ok(actor.liked)
    assert.strictEqual(actor.get('preferredUsername').first, 'test8')
    assert.strictEqual(actor.name.get(), 'Test User')
    assert.strictEqual(actor.summary.get(), 'A test user')
    assert.ok(Array.isArray(actor.type))
    assert.ok(actor.type.includes(AS2_NS + 'Person'))
    assert.ok(actor.type.includes(AS2_NS + 'Service'))
  })

  it('can get all actors with an object in a collection', async () => {
    for (const i of [101, 102, 103, 104, 105]) {
      await storage.addToCollection(`test${i}`, 'following', other)
    }
    const usernames = await storage.getUsernamesWith('following', other)
    assert.strictEqual(usernames.length, 5)
    assert.ok(usernames.includes('test101'))
    assert.ok(usernames.includes('test102'))
    assert.ok(usernames.includes('test103'))
    assert.ok(usernames.includes('test104'))
    assert.ok(usernames.includes('test105'))
  })

  it('gets zero usernames when an object is in no collection', async () => {
    const usernames = await storage.getUsernamesWith('following', unfollowed)
    assert.strictEqual(usernames.length, 0)
  })

  describe('last activity', async () => {
    const username = 'test16'
    let object, activity1, activity2

    before(async () => {
      object = await as2.import({
        id: 'https://social.example/note/26158',
        type: 'Note'
      })
      activity1 = await as2.import({
        id: 'https://social.example/like/4605',
        type: 'Like',
        object: {
          id: 'https://social.example/note/26158',
          type: 'Note'
        }
      })
      activity2 = await as2.import({
        id: 'https://social.example/like/900',
        type: 'Like',
        object: {
          id: 'https://social.example/note/26158',
          type: 'Note'
        }
      })
    })

    it('returns null if no activity has been set', async () => {
      const result = await storage.getLastActivity(
        username,
        'Like',
        object
      )
      assert.ok(!result)
    })

    it('can set the last activity for an object', async () => {
      await storage.setLastActivity(username, activity1)
      assert.ok(true)
    })

    it('can get the last activity for an object', async () => {
      const result = await storage.getLastActivity(
        username,
        'Like',
        object
      )
      assert.strictEqual(result, activity1.id)
    })

    it('can overwrite the last activity for an object', async () => {
      await storage.setLastActivity(username, activity2)
      assert.ok(true)
      const result = await storage.getLastActivity(
        username,
        'Like',
        object
      )
      assert.strictEqual(result, activity2.id)
    })

    it('can clear the last activity for an object', async () => {
      await storage.clearLastActivity(username, 'Like', object)
      assert.ok(true)
    })

    it('returns null if the last activity has been cleared', async () => {
      const result = await storage.getLastActivity(
        username,
        'Like',
        object
      )
      assert.ok(!result)
    })
  })
})
