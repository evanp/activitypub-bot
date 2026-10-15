import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { nanoid } from 'nanoid'
import request from 'supertest'

import { makeApp } from '../lib/app.js'
import as2 from '../lib/activitystreams.js'
import DoNothingBot from '../lib/bots/donothing.js'
import { cleanupRedis, cleanupTestData, getTestDatabaseUrl, getTestRedisUrl } from './utils/db.js'

describe('seekItem collection routes', () => {
  const localDomain = 'local.routes-seekitem.test'
  const origin = `https://${localDomain}`
  const username = 'routesseekitemtest'
  const actorCollections = ['outbox', 'liked', 'followers', 'following']
  const objectCollections = ['replies', 'shares', 'likes', 'thread']
  const fixtures = new Map()
  let app

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      origin,
      databaseUrl: getTestDatabaseUrl(),
      redisUrl: getTestRedisUrl(),
      bots: { [username]: new DoNothingBot(username) },
      domainBlockFileName: fileURLToPath(new URL('./fixtures/blocklist-basic.csv', import.meta.url)),
      logLevel: 'silent'
    })
    await cleanupTestData(app.locals.connection, { usernames: [username], localDomain })
    const { formatter, objectStorage, actorStorage } = app.locals
    const owner = formatter.format({ username })

    for (const collection of [...actorCollections, ...objectCollections]) {
      const isActorCollection = actorCollections.includes(collection)
      const hasActors = ['followers', 'following'].includes(collection)
      const type = hasActors ? 'Person' : collection === 'outbox' ? 'IntransitiveActivity' : collection === 'likes' ? 'Like' : collection === 'shares' ? 'Announce' : 'Note'
      const parent = await as2.import({
        id: formatter.format({ username, type: 'note', nanoid: nanoid() }),
        type: 'Note',
        attributedTo: owner,
        to: 'as:Public'
      })
      const privateParent = await as2.import({
        id: formatter.format({ username, type: 'note', nanoid: nanoid() }),
        type: 'Note',
        attributedTo: owner,
        to: owner
      })
      await objectStorage.create(parent)
      await objectStorage.create(privateParent)
      const members = {}
      for (const visibility of ['readable', 'missing', 'unreadable']) {
        const member = await as2.import({
          id: hasActors
            ? `https://${visibility === 'unreadable' ? 'blocked-one.test' : 'remote.routes-seekitem.test'}/users/${collection}-${visibility}`
            : formatter.format({ username, type: type.toLowerCase(), nanoid: nanoid() }),
          type,
          attributedTo: owner,
          actor: ['IntransitiveActivity', 'Like', 'Announce'].includes(type) ? owner : undefined,
          object: ['Like', 'Announce'].includes(type) ? parent.id : undefined,
          inReplyTo: collection === 'replies' ? parent.id : undefined,
          to: visibility === 'unreadable' ? owner : 'as:Public'
        })
        await objectStorage.create(member)
        members[visibility] = member
        if (visibility !== 'missing') {
          if (isActorCollection) {
            await actorStorage.addToCollection(username, collection, member)
          } else {
            await objectStorage.addToCollection(parent.id, collection, member)
            await objectStorage.addToCollection(privateParent.id, collection, member)
          }
        }
      }
      fixtures.set(collection, {
        ...members,
        id: `${isActorCollection ? owner : parent.id}/${collection}`,
        privateParent
      })
    }
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) return
    try {
      await cleanupTestData(app.locals.connection, { usernames: [username], localDomain })
    } finally {
      await app.cleanup()
    }
  })

  function localPath (url) {
    const parsed = new URL(url)
    assert.equal(parsed.origin, origin)
    return parsed.pathname + parsed.search
  }

  async function seek (collection, item) {
    const response = await request(app).get(localPath(fixtures.get(collection).id))
    assert.equal(response.status, 200)
    assert.equal(typeof response.body.seekItem, 'string', 'collection must advertise seekItem')
    const endpoint = new URL(response.body.seekItem)
    endpoint.searchParams.set('item', item.id)
    return request(app).get(localPath(endpoint))
  }

  function assertNotFound (response) {
    assert.equal(response.status, 404)
    assert.equal(response.type, 'application/problem+json')
    assert.equal(response.body.status, 404)
    assert.equal(response.headers.location, undefined)
  }

  for (const collection of [...actorCollections, ...objectCollections]) {
    describe(collection, () => {
      it('advertises an HTTPS seekItem endpoint', async () => {
        const response = await request(app).get(localPath(fixtures.get(collection).id))
        assert.equal(response.status, 200)
        assert.equal(typeof response.body.seekItem, 'string')
        assert.equal(new URL(response.body.seekItem).protocol, 'https:')
      })

      it('redirects to the collection containing a readable inline member', async () => {
        const { id, readable } = fixtures.get(collection)
        const response = await seek(collection, readable)
        assert.ok([307, 308].includes(response.status), `expected redirect, got ${response.status}`)
        assert.equal(response.headers.location, id)
        const target = await request(app).get(localPath(response.headers.location))
        assert.equal(target.status, 200)
        assert.equal(target.type, 'application/activity+json')
        assert.equal(target.body.id, id)
        assert.ok(target.body.orderedItems.includes(readable.id))
      })

      it('returns 404 for a readable item that is not a member', async () => {
        assertNotFound(await seek(collection, fixtures.get(collection).missing))
      })

      it('returns 404 for a member unreadable by the anonymous principal', async () => {
        assertNotFound(await seek(collection, fixtures.get(collection).unreadable))
      })

      if (['replies', 'shares', 'likes'].includes(collection)) {
        it('returns 404 when the collection is unreadable even if the member is public', async () => {
          const { privateParent, readable } = fixtures.get(collection)
          assert.equal(await app.locals.authorizer.canRead(null, privateParent), false)
          assert.equal(await app.locals.authorizer.canRead(null, readable), true)
          // Discover the private endpoint internally because its collection cannot be fetched anonymously.
          const stored = await app.locals.objectStorage.getCollection(privateParent.id, collection)
          const exported = await stored.export({ useOriginalContext: true })
          assert.equal(typeof exported.seekItem, 'string', 'private collection must advertise seekItem')
          const endpoint = new URL(exported.seekItem)
          endpoint.searchParams.set('item', readable.id)
          assertNotFound(await request(app).get(localPath(endpoint)))
        })
      }
    })
  }
})
