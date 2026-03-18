import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

import Logger from 'pino'

import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { JobQueue } from '../lib/jobqueue.js'
import { RateLimiter } from '../lib/ratelimiter.js'

describe('ActivityDeliverer', async () => {
  const localHost = 'local.activitydeliverer.test'
  const remoteHost = 'remote.activitydeliverer.test'
  const origin = `https://${localHost}`
  const testUsernames = ['activitydeliverertest1', 'activitydeliverertest2']
  let connection
  let actorStorage
  let formatter
  let logger
  let client
  let jobQueue
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
    const keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    const limiter = new RateLimiter(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter)
    jobQueue = new JobQueue(connection, logger)
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
    formatter = null
    logger = null
    client = null
    jobQueue = null
    ActivityDeliverer = null
    deliverer = null
  })

  it('can import the library', async () => {
    ActivityDeliverer = (await import('../lib/activitydeliverer.js')).ActivityDeliverer
    assert.ok(ActivityDeliverer)
    assert.equal(typeof ActivityDeliverer, 'function')
  })

  it('can initialize', async () => {
    deliverer = new ActivityDeliverer(actorStorage, formatter, logger, client, jobQueue)
    assert.ok(deliverer)
  })
})
