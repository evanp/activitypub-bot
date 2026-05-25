import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import { ActorStorage } from '../lib/actorstorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from '../lib/activitystreams.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const MAX_PAGE_SIZE = 256
const AS2_NS = 'https://www.w3.org/ns/activitystreams#'
const LOCAL_USER = 'actorstoragetest1'
const FOLLOWERS_USER = 'actorstoragetest3'
const LIKED_USER_A = 'actorstoragetest4'
const LIKED_USER_B = 'actorstoragetest5'
const LIKED_USER_C = 'actorstoragetest6'
const LIKED_USER_D = 'actorstoragetest7'
const CUSTOM_USER = 'actorstoragetest8'
const LAST_ACTIVITY_USER = 'actorstoragetest16'
const FOLLOWING_USERS = Array.from({ length: 5 }, (_, i) => `actorstoragetest${101 + i}`)
const ACTIVE_RECENT_A = 'actorstoragetestactive1'
const ACTIVE_RECENT_B = 'actorstoragetestactive2'
const ACTIVE_OLDER = 'actorstoragetestactive3'
const ACTIVE_ANCIENT = 'actorstoragetestactive4'
const TEST_USERNAMES = [
  LOCAL_USER,
  FOLLOWERS_USER,
  LIKED_USER_A,
  LIKED_USER_B,
  LIKED_USER_C,
  LIKED_USER_D,
  CUSTOM_USER,
  LAST_ACTIVITY_USER,
  ACTIVE_RECENT_A,
  ACTIVE_RECENT_B,
  ACTIVE_OLDER,
  ACTIVE_ANCIENT,
  ...FOLLOWING_USERS
]

describe('ActorStorage', () => {
  let connection = null
  let storage = null
  let formatter = null
  let other = null
  let unfollowed = null

  before(async () => {
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, { usernames: TEST_USERNAMES })
    formatter = new UrlFormatter('https://local.actorstorage.test')
    other = await as2.import({
      id: 'https://social.actorstorage.test/user/test2',
      type: 'Person'
    })
    unfollowed = await as2.import({
      id: 'https://social.actorstorage.test/user/test3',
      type: 'Person'
    })
  })
  after(async () => {
    await cleanupTestData(connection, { usernames: TEST_USERNAMES })
    await connection.close()
  })
  it('can create an instance', () => {
    storage = new ActorStorage(connection, formatter)
    assert.ok(storage instanceof ActorStorage)
  })
  it('can initialize the storage', async () => {
  })
  it('can get an actor', async () => {
    const actor = await storage.getActor(LOCAL_USER)
    assert.ok(actor)
    assert.ok(actor.id)
    assert.ok(actor.inbox)
    assert.ok(actor.outbox)
    assert.ok(actor.followers)
    assert.ok(actor.following)
    assert.ok(actor.liked)
    assert.strictEqual(actor.get('preferredUsername').first, LOCAL_USER)
  })

  it('can get an actor by id', async () => {
    const actor = await storage.getActorById(`https://local.actorstorage.test/user/${LOCAL_USER}`)
    assert.ok(actor)
    assert.ok(actor.id)
    assert.ok(actor.inbox)
    assert.ok(actor.outbox)
    assert.ok(actor.followers)
    assert.ok(actor.following)
    assert.ok(actor.liked)
    assert.strictEqual(actor.get('preferredUsername').first, LOCAL_USER)
  })
  it('can get an empty collection', async () => {
    const collection = await storage.getCollection(LOCAL_USER, 'followers')
    assert.ok(collection)
    assert.strictEqual(collection.id, `https://local.actorstorage.test/user/${LOCAL_USER}/followers`)
    assert.strictEqual(collection.type, 'https://www.w3.org/ns/activitystreams#OrderedCollection')
    assert.strictEqual(collection.totalItems, 0)
    assert.ok(collection.first)
    assert.ok(collection.last)
  })
  it('can get an empty collection page', async () => {
    const page = await storage.getCollectionPage(LOCAL_USER, 'followers', 1)
    assert.ok(page)
    assert.strictEqual(
      page.id,
      `https://local.actorstorage.test/user/${LOCAL_USER}/followers/1`
    )
    assert.strictEqual(page.type, 'https://www.w3.org/ns/activitystreams#OrderedCollectionPage')
    assert.strictEqual(
      page.partOf.id,
      `https://local.actorstorage.test/user/${LOCAL_USER}/followers`
    )
    assert.ok(!page.next)
    assert.ok(!page.prev)
  })
  it('can add to a collection', async () => {
    const collection = await storage.getCollection(FOLLOWERS_USER, 'followers')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      FOLLOWERS_USER,
      'followers',
      other
    )
    const collection2 = await storage.getCollection(FOLLOWERS_USER, 'followers')
    assert.strictEqual(collection2.totalItems, 1)
    const page = await storage.getCollectionPage(FOLLOWERS_USER, 'followers', 1)
    assert.strictEqual(page.items.length, 1)
    assert.strictEqual(Array.from(page.items)[0].id, 'https://social.actorstorage.test/user/test2')
  })
  it('can remove from a collection', async () => {
    await storage.removeFromCollection(
      FOLLOWERS_USER,
      'followers',
      other
    )
    const collection2 = await storage.getCollection(FOLLOWERS_USER, 'followers')
    assert.strictEqual(collection2.totalItems, 0)
    const page = await storage.getCollectionPage(FOLLOWERS_USER, 'followers', 1)
    assert.ok(!page.items)
  })
  it('can add a lot of items a collection', async () => {
    for (let i = 0; i < 3 * MAX_PAGE_SIZE; i++) {
      const other = await as2.import({
        id: `https://social.actorstorage.test/user/foo/note/${i}`,
        type: 'Note',
        content: `Hello World ${i}`
      })
      await storage.addToCollection(
        LIKED_USER_A,
        'liked',
        other
      )
    }
    const collection = await storage.getCollection(LIKED_USER_A, 'liked')
    assert.strictEqual(collection.totalItems, 3 * MAX_PAGE_SIZE)
    const page = await storage.getCollectionPage(LIKED_USER_A, 'liked', 2)
    assert.strictEqual(page.items.length, MAX_PAGE_SIZE)
    assert.ok(page.next)
  })
  it('can iterate over a collection', async () => {
    const seen = new Set()
    for await (const item of storage.items(LIKED_USER_A, 'liked')) {
      assert.ok(!(item.id in seen))
      seen.add(item.id)
    }
    assert.strictEqual(seen.size, 3 * MAX_PAGE_SIZE)
  })
  it('can add twice and remove once from a collection', async () => {
    const other = await as2.import({
      id: 'https://social.actorstorage.test/user/foo/note/200',
      type: 'Note',
      content: 'Hello World 200'
    })
    const other2 = await as2.import({
      id: 'https://social.actorstorage.test/user/foo/note/201',
      type: 'Note',
      content: 'Hello World 201'
    })
    const collection = await storage.getCollection(LIKED_USER_B, 'liked')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      LIKED_USER_B,
      'liked',
      other
    )
    await storage.addToCollection(
      LIKED_USER_B,
      'liked',
      other2
    )
    const collection2 = await storage.getCollection(LIKED_USER_B, 'liked')
    assert.strictEqual(collection2.totalItems, 2)
    await storage.removeFromCollection(
      LIKED_USER_B,
      'liked',
      other
    )
    const collection3 = await storage.getCollection(LIKED_USER_B, 'liked')
    assert.strictEqual(collection3.totalItems, 1)
  })
  it('can check if something is in the collection', async () => {
    const other = await as2.import({
      id: 'https://social.actorstorage.test/user/foo/note/300',
      type: 'Note',
      content: 'Hello World 300'
    })
    const other2 = await as2.import({
      id: 'https://social.actorstorage.test/user/foo/note/301',
      type: 'Note',
      content: 'Hello World 301'
    })
    let collection = await storage.getCollection(LIKED_USER_C, 'liked')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      LIKED_USER_C,
      'liked',
      other
    )
    collection = await storage.getCollection(LIKED_USER_C, 'liked')
    assert.strictEqual(collection.totalItems, 1)
    assert.ok(await storage.isInCollection(
      LIKED_USER_C,
      'liked',
      other
    ))
    assert.ok(!await storage.isInCollection(
      LIKED_USER_C,
      'liked',
      other2
    ))
  })

  it('retains totalItems when we remove an absent object', async () => {
    const other = await as2.import({
      id: 'https://social.actorstorage.test/user/foo/note/400',
      type: 'Note',
      content: 'Hello World 400'
    })
    const other2 = await as2.import({
      id: 'https://social.actorstorage.test/user/foo/note/401',
      type: 'Note',
      content: 'Hello World 401'
    })
    const other3 = await as2.import({
      id: 'https://social.actorstorage.test/user/foo/note/402',
      type: 'Note',
      content: 'Hello World 402'
    })
    let collection = await storage.getCollection(LIKED_USER_D, 'liked')
    assert.strictEqual(collection.totalItems, 0)
    await storage.addToCollection(
      LIKED_USER_D,
      'liked',
      other
    )
    await storage.addToCollection(
      LIKED_USER_D,
      'liked',
      other2
    )
    collection = await storage.getCollection(LIKED_USER_D, 'liked')
    assert.strictEqual(collection.totalItems, 2)
    await storage.removeFromCollection(
      LIKED_USER_D,
      'liked',
      other3
    )
    collection = await storage.getCollection(LIKED_USER_D, 'liked')
    assert.strictEqual(collection.totalItems, 2)
  })
  it('can get an actor with custom properties', async () => {
    const props = {
      name: 'Test User',
      summary: 'A test user',
      type: 'Person'
    }
    const actor = await storage.getActor(CUSTOM_USER, props)
    assert.ok(actor)
    assert.ok(actor.id)
    assert.ok(actor.inbox)
    assert.ok(actor.outbox)
    assert.ok(actor.followers)
    assert.ok(actor.following)
    assert.ok(actor.liked)
    assert.strictEqual(actor.get('preferredUsername').first, CUSTOM_USER)
    assert.strictEqual(actor.name.get(), 'Test User')
    assert.strictEqual(actor.summary.get(), 'A test user')
    assert.ok(Array.isArray(actor.type))
    assert.ok(actor.type.includes(AS2_NS + 'Person'))
    assert.ok(actor.type.includes(AS2_NS + 'Service'))
  })

  it('can get all actors with an object in a collection', async () => {
    for (const username of FOLLOWING_USERS) {
      await storage.addToCollection(username, 'following', other)
    }
    const usernames = await storage.getUsernamesWith('following', other)
    assert.strictEqual(usernames.length, 5)
    for (const username of FOLLOWING_USERS) {
      assert.ok(usernames.includes(username))
    }
  })

  it('gets zero usernames when an object is in no collection', async () => {
    const usernames = await storage.getUsernamesWith('following', unfollowed)
    assert.strictEqual(usernames.length, 0)
  })

  describe('last activity', async () => {
    const username = LAST_ACTIVITY_USER
    let object, activity1, activity2

    before(async () => {
      object = await as2.import({
        id: 'https://social.actorstorage.test/note/26158',
        type: 'Note'
      })
      activity1 = await as2.import({
        id: 'https://social.actorstorage.test/like/4605',
        type: 'Like',
        object: {
          id: 'https://social.actorstorage.test/note/26158',
          type: 'Note'
        }
      })
      activity2 = await as2.import({
        id: 'https://social.actorstorage.test/like/900',
        type: 'Like',
        object: {
          id: 'https://social.actorstorage.test/note/26158',
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

  describe('activeUsers', async () => {
    let baseline30 = null
    let baseline180 = null

    it('returns a non-negative integer for 30 days', async () => {
      baseline30 = await storage.activeUsers(30)
      assert.strictEqual(typeof baseline30, 'number')
      assert.ok(Number.isInteger(baseline30))
      assert.ok(baseline30 >= 0)
    })

    it('returns a non-negative integer for 180 days', async () => {
      baseline180 = await storage.activeUsers(180)
      assert.strictEqual(typeof baseline180, 'number')
      assert.ok(Number.isInteger(baseline180))
      assert.ok(baseline180 >= 0)
    })

    it('180-day count is greater than or equal to 30-day count', async () => {
      assert.ok(baseline180 >= baseline30)
    })

    it('counts users with recent outbox entries within 30 days', async () => {
      const before = await storage.activeUsers(30)
      const object = await as2.import({
        id: `https://social.actorstorage.test/user/${ACTIVE_RECENT_A}/note/1`,
        type: 'Note',
        content: 'fresh note'
      })
      await storage.addToCollection(ACTIVE_RECENT_A, 'outbox', object)
      const after = await storage.activeUsers(30)
      assert.strictEqual(after, before + 1)
    })

    it('does not count users whose only outbox entry is older than the window', async () => {
      const object = await as2.import({
        id: `https://social.actorstorage.test/user/${ACTIVE_OLDER}/note/1`,
        type: 'Note',
        content: 'older note'
      })
      await storage.addToCollection(ACTIVE_OLDER, 'outbox', object)
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      await connection.query(
        `UPDATE actorcollectionpage SET createdat = ? WHERE username = ? AND property = 'outbox'`,
        { replacements: [sixtyDaysAgo, ACTIVE_OLDER] }
      )
      const count30 = await storage.activeUsers(30)
      const count180 = await storage.activeUsers(180)
      assert.ok(count180 > count30, `expected 180d (${count180}) > 30d (${count30})`)
    })

    it('does not count users whose only outbox entry is older than 180 days', async () => {
      const object = await as2.import({
        id: `https://social.actorstorage.test/user/${ACTIVE_ANCIENT}/note/1`,
        type: 'Note',
        content: 'ancient note'
      })
      await storage.addToCollection(ACTIVE_ANCIENT, 'outbox', object)
      const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000)
      await connection.query(
        `UPDATE actorcollectionpage SET createdat = ? WHERE username = ? AND property = 'outbox'`,
        { replacements: [twoHundredDaysAgo, ACTIVE_ANCIENT] }
      )
      const before = await storage.activeUsers(180)
      const object2 = await as2.import({
        id: `https://social.actorstorage.test/user/${ACTIVE_RECENT_B}/note/1`,
        type: 'Note',
        content: 'recent note'
      })
      await storage.addToCollection(ACTIVE_RECENT_B, 'outbox', object2)
      const after = await storage.activeUsers(180)
      assert.strictEqual(after, before + 1, `expected delta of 1 (the recent user); ancient user should not be counted`)
    })
  })
})
