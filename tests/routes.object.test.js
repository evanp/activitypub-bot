import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import bots from './fixtures/bots.js'
import as2 from 'activitystrea.ms'
import { nockSetup, nockFormat, nockSignature, makeActor } from './utils/nock.js'

const uppercase = (string) => string.charAt(0).toUpperCase() + string.slice(1)

describe('actor collection routes', async () => {
  const databaseUrl = 'sqlite::memory:'
  const origin = 'https://activitypubbot.test'
  const username = 'ok'
  const type = 'object'
  const nanoid = 'hUQC9HWian7dzOxZJlJBA'
  let app = null
  let obj = null
  let reply = null
  let like = null
  let share = null
  let privateObj = null
  const privateNanoid = 'Ic3Sa_0xOQKvlPsWU16as'

  before(async () => {
    app = await makeApp(databaseUrl, origin, bots, 'silent')
    const { formatter, objectStorage, actorStorage } = app.locals
    nockSetup('social.example')
    obj = await as2.import({
      id: formatter.format({ username, type, nanoid }),
      type: uppercase(type),
      attributedTo: formatter.format({ username }),
      summaryMap: {
        en: 'Test object for the object collection routes'
      },
      replies: formatter.format({ username, type, nanoid, collection: 'replies' }),
      likes: formatter.format({ username, type, nanoid, collection: 'likes' }),
      shares: formatter.format({ username, type, nanoid, collection: 'shares' }),
      to: ['as:Public']
    })
    await objectStorage.create(obj)
    reply = await as2.import({
      id: nockFormat({
        domain: 'social.example',
        username: 'replier1',
        type: 'note',
        num: 1
      }),
      type: 'Note',
      attributedTo: nockFormat({
        domain: 'social.example',
        username: 'replier1'
      }),
      content: 'This is a reply to the test object',
      inReplyTo: obj.id,
      to: [formatter.format({ username }), 'as:Public']
    })
    await objectStorage.addToCollection(obj.id, 'replies', reply)
    like = await as2.import({
      id: nockFormat({
        domain: 'social.example',
        username: 'liker1',
        type: 'like',
        num: 1,
        obj: obj.id
      }),
      type: 'Like',
      attributedTo: nockFormat({
        domain: 'social.example',
        username: 'liker1'
      }),
      object: obj.id,
      to: [formatter.format({ username }), 'as:Public']
    })
    await objectStorage.addToCollection(obj.id, 'likes', like)
    share = await as2.import({
      id: nockFormat({
        domain: 'social.example',
        username: 'sharer1',
        type: 'announce',
        num: 1,
        obj: obj.id
      }),
      type: 'Announce',
      attributedTo: nockFormat({
        domain: 'social.example',
        username: 'sharer1'
      }),
      object: obj.id,
      to: [formatter.format({ username }), 'as:Public']
    })
    await objectStorage.addToCollection(obj.id, 'shares', share)
    privateObj = await as2.import({
      id: formatter.format({ username, type, nanoid: privateNanoid }),
      type: uppercase(type),
      attributedTo: formatter.format({ username }),
      summaryMap: {
        en: 'Test object for the object collection routes'
      },
      replies: formatter.format({ username, type, nanoid, collection: 'replies' }),
      likes: formatter.format({ username, type, nanoid, collection: 'likes' }),
      shares: formatter.format({ username, type, nanoid, collection: 'shares' }),
      to: formatter.format({ username, collection: 'followers' })
    })
    await objectStorage.create(privateObj)
    await actorStorage.addToCollection(
      username,
      'followers',
      await makeActor('follower1', 'social.example')
    )
  })

  describe('GET /user/{username}/{type}/{nanoid}', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `https://activitypubbot.test/user/${username}/${type}/${nanoid}`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'Object')
    })
    it('should return an object with the right summary', async () => {
      assert.strictEqual(typeof response.body.summaryMap, 'object')
      assert.strictEqual(response.body.summaryMap.en, 'Test object for the object collection routes')
    })
    it('should return an object with the right replies', async () => {
      assert.strictEqual(typeof response.body.replies, 'string')
      assert.strictEqual(response.body.replies, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/replies`)
    })
    it('should return an object with the right likes', async () => {
      assert.strictEqual(typeof response.body.likes, 'string')
      assert.strictEqual(response.body.likes, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/likes`)
    })
    it('should return an object with the right shares', async () => {
      assert.strictEqual(typeof response.body.shares, 'string')
      assert.strictEqual(response.body.shares, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/shares`)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/replies', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/replies`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/replies`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollection')
    })
    it('should return an object with the right totalItems', async () => {
      assert.strictEqual(typeof response.body.totalItems, 'number')
      assert.strictEqual(response.body.totalItems, 1)
    })
    it('should return an object with the right first', async () => {
      assert.strictEqual(typeof response.body.first, 'string')
      assert.strictEqual(response.body.first, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/replies/1`)
    })
    it('should return an object with the right last', async () => {
      assert.strictEqual(typeof response.body.last, 'string')
      assert.strictEqual(response.body.last, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/replies/1`)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/replies/1', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/replies/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/replies/1`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollectionPage')
    })
    it('should return an object with the right partOf', async () => {
      assert.strictEqual(typeof response.body.partOf, 'string')
      assert.strictEqual(response.body.partOf, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/replies`)
    })
    it('should return an object with the right items', async () => {
      assert.strictEqual(typeof response.body.items, 'object')
      assert.strictEqual(response.body.items.length, 1)
      assert.strictEqual(response.body.items[0], reply.id)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/likes', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/likes`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/likes`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollection')
    })
    it('should return an object with the right totalItems', async () => {
      assert.strictEqual(typeof response.body.totalItems, 'number')
      assert.strictEqual(response.body.totalItems, 1)
    })
    it('should return an object with the right first', async () => {
      assert.strictEqual(typeof response.body.first, 'string')
      assert.strictEqual(response.body.first, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/likes/1`)
    })
    it('should return an object with the right last', async () => {
      assert.strictEqual(typeof response.body.last, 'string')
      assert.strictEqual(response.body.last, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/likes/1`)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/likes/1', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/likes/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/likes/1`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollectionPage')
    })
    it('should return an object with the right partOf', async () => {
      assert.strictEqual(typeof response.body.partOf, 'string')
      assert.strictEqual(response.body.partOf, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/likes`)
    })
    it('should return an object with the right items', async () => {
      assert.strictEqual(typeof response.body.items, 'object')
      assert.strictEqual(response.body.items.length, 1)
      assert.strictEqual(response.body.items[0], like.id)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/shares', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/shares`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/shares`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollection')
    })
    it('should return an object with the right totalItems', async () => {
      assert.strictEqual(typeof response.body.totalItems, 'number')
      assert.strictEqual(response.body.totalItems, 1)
    })
    it('should return an object with the right first', async () => {
      assert.strictEqual(typeof response.body.first, 'string')
      assert.strictEqual(response.body.first, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/shares/1`)
    })
    it('should return an object with the right last', async () => {
      assert.strictEqual(typeof response.body.last, 'string')
      assert.strictEqual(response.body.last, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/shares/1`)
    })
  })

  describe('GET /user/{username}/{type}/{nanoid}/shares/1', async () => {
    let response = null
    const url = `/user/${username}/${type}/${nanoid}/shares/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object the right id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
      assert.strictEqual(response.body.id, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/shares/1`)
    })
    it('should return an object with the right type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
      assert.strictEqual(response.body.type, 'OrderedCollectionPage')
    })
    it('should return an object with the right partOf', async () => {
      assert.strictEqual(typeof response.body.partOf, 'string')
      assert.strictEqual(response.body.partOf, `https://activitypubbot.test/user/${username}/${type}/${nanoid}/shares`)
    })
    it('should return an object with the right items', async () => {
      assert.strictEqual(typeof response.body.items, 'object')
      assert.strictEqual(response.body.items.length, 1)
      assert.strictEqual(response.body.items[0], share.id)
    })
  })

  describe('Get private object anonymously', async () => {
    let response = null
    const url = `/user/${username}/${type}/${privateNanoid}`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })

  describe('Get private object collection anonymously', async () => {
    let response = null
    const url = `/user/${username}/${type}/${privateNanoid}/replies`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })

  describe('Get private object collection page anonymously', async () => {
    let response = null
    const url = `/user/${username}/${type}/${privateNanoid}/replies/1`
    it('should work without an error', async () => {
      response = await request(app)
        .get(url)
    })
    it('should return a 403 status', async () => {
      assert.strictEqual(response.status, 403)
    })
  })

  describe('Get private object with follower', async () => {
    let response = null
    const path = `/user/${username}/${type}/${privateNanoid}`
    const url = `${origin}${path}`
    const date = new Date().toISOString()
    const signature = await nockSignature({ username: 'follower1', url, date })
    it('should work without an error', async () => {
      response = await request(app)
        .get(path)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', 'activitypubbot.test')
    })
    it('should return a 200 status', async () => {
      assert.strictEqual(response.status, 200)
    })
  })
})
