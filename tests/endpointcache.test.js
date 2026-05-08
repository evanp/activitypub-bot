import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { EndpointCache } from '../lib/endpointcache.js'
import { createMigratedTestConnection } from './utils/db.js'

const REMOTE_HOST = 'social.endpointcache.test'

describe('EndpointCache', async () => {
  const REMOTE_ACTOR_ID = `https://${REMOTE_HOST}/user/testactor`

  let connection = null
  let logger = null
  let cache = null

  before(async () => {
    logger = new Logger({ level: 'silent' })
    connection = await createMigratedTestConnection()
    cache = new EndpointCache(connection, logger)
  })

  after(async () => {
    await connection.close()
  })

  it('get on a cold cache returns null', async () => {
    const result = await cache.get(REMOTE_ACTOR_ID, 'inbox')
    assert.equal(result, null)
  })

  it('set then get returns the stored url', async () => {
    const inboxUrl = `${REMOTE_ACTOR_ID}/inbox`
    await cache.set(REMOTE_ACTOR_ID, 'inbox', inboxUrl)
    const result = await cache.get(REMOTE_ACTOR_ID, 'inbox')
    assert.equal(result, inboxUrl)
  })

  it('get returns null for an expired row', async () => {
    const expiredActorId = `https://${REMOTE_HOST}/user/expiredactor`
    const inboxUrl = `${expiredActorId}/inbox`
    const pastExpiry = new Date(Date.now() - 60 * 1000)
    await connection.query(
      `INSERT INTO endpoint_cache (actor_id, name, url, expiry)
       VALUES (?, ?, ?, ?)`,
      { replacements: [expiredActorId, 'inbox', inboxUrl, pastExpiry] }
    )
    const result = await cache.get(expiredActorId, 'inbox')
    assert.equal(result, null)
  })

  it('set replaces an existing entry for the same actor and name', async () => {
    const upsertActorId = `https://${REMOTE_HOST}/user/upsertactor`
    const firstInbox = `${upsertActorId}/inbox`
    const secondInbox = `${upsertActorId}/new-inbox`
    await cache.set(upsertActorId, 'inbox', firstInbox)
    await cache.set(upsertActorId, 'inbox', secondInbox)
    const result = await cache.get(upsertActorId, 'inbox')
    assert.equal(result, secondInbox)
  })

  it('entries for different actors do not collide', async () => {
    const actorA = `https://${REMOTE_HOST}/user/isolation-a`
    const actorB = `https://${REMOTE_HOST}/user/isolation-b`
    await cache.set(actorA, 'inbox', `${actorA}/inbox`)
    await cache.set(actorB, 'inbox', `${actorB}/inbox`)
    assert.equal(await cache.get(actorA, 'inbox'), `${actorA}/inbox`)
    assert.equal(await cache.get(actorB, 'inbox'), `${actorB}/inbox`)
  })

  it('different names for the same actor do not collide', async () => {
    const actorId = `https://${REMOTE_HOST}/user/multiendpoint`
    await cache.set(actorId, 'inbox', `${actorId}/inbox`)
    await cache.set(actorId, 'sharedInbox', `https://${REMOTE_HOST}/inbox`)
    assert.equal(await cache.get(actorId, 'inbox'), `${actorId}/inbox`)
    assert.equal(await cache.get(actorId, 'sharedInbox'), `https://${REMOTE_HOST}/inbox`)
  })
})
