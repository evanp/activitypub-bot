import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

import Logger from 'pino'

import { ActivityHandler } from '../lib/activityhandler.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { Authorizer } from '../lib/authorizer.js'
import { ObjectCache } from '../lib/objectcache.js'

describe('ActivityDeliverer', async () => {
  const localHost = 'activitydeliverer.local.test'
  const remoteHost = 'activitydeliverer.remote.test'
  const origin = `https://${localHost}`
  const testUsernames = ['activitydeliverertest1', 'activitydeliverertest2']
  let connection
  let actorStorage
  let handler
  let formatter
  let logger
  let client
  let ActivityDeliverer
  let deliverer

  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter(origin)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost]
    })
    actorStorage = new ActorStorage(connection, formatter)
    const objectStorage = new ObjectStorage(connection)
    const keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    const distributor = new ActivityDistributor(client, formatter, actorStorage, logger)
    const authz = new Authorizer(actorStorage, formatter, client)
    const cache = new ObjectCache({ longTTL: 3600 * 1000, shortTTL: 300 * 1000, maxItems: 1000 })
    handler = new ActivityHandler(
      actorStorage,
      objectStorage,
      distributor,
      formatter,
      cache,
      authz,
      logger,
      client
    )
  })
  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost]
    })
    await connection.close()
    connection = null
    actorStorage = null
    handler = null
    formatter = null
    logger = null
    client = null
    ActivityDeliverer = null
    deliverer = null
  })

  it('can import the library', async () => {
    ActivityDeliverer = (await import('../lib/activitydeliverer.js')).ActivityDeliverer
    assert.ok(ActivityDeliverer)
    assert.equal(typeof ActivityDeliverer, 'function')
  })

  it('can initialize', async () => {
    deliverer = new ActivityDeliverer(actorStorage, handler, formatter, logger, client)
    assert.ok(deliverer)
  })
})
