import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

import Logger from 'pino'

import as2 from '../lib/activitystreams.js'
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
import { JobQueue } from '../lib/jobqueue.js'
import DoNothingBot from '../lib/bots/donothing.js'

describe('DeliveryWorker', async () => {
  const localHost = 'local.deliveryworker.test'
  const remoteHost = 'remote.deliveryworker.test'
  const origin = `https://${localHost}`
  const testUsernames = ['deliveryworkertest1', 'deliveryworkertest2']
  const testBots = {
    [testUsernames[0]]: new DoNothingBot(testUsernames[0]),
    [testUsernames[1]]: new DoNothingBot(testUsernames[1])
  }
  let connection
  let actorStorage
  let handler
  let formatter
  let logger
  let client
  let DeliveryWorker
  let worker
  let queue

  before(async () => {
    logger = Logger({ level: 'debug' })
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
    queue = new JobQueue(connection, logger)
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
    DeliveryWorker = null
    worker = null
  })

  it('can import the library', async () => {
    DeliveryWorker = (await import('../lib/deliveryworker.js')).DeliveryWorker
    assert.ok(DeliveryWorker)
    assert.equal(typeof DeliveryWorker, 'function')
  })

  it('can initialize', async () => {
    worker = new DeliveryWorker(queue, actorStorage, handler, logger, testBots)
    assert.ok(worker)
  })

  it('can run a little bit', async () => {
    const activity = await as2.import({
      id: `https://${remoteHost}/activity/1`,
      type: 'Activity'
    })
    const json = await activity.export()
    queue.enqueue('delivery', { bot: testUsernames[0], activity: json })
    queue.enqueue('delivery', { bot: testUsernames[1], activity: json })
    setTimeout(() => {
      queue.onIdle('delivery').then(() => {
        logger.debug('Stopping worker')
        worker.stop()
        logger.debug('Aborting queue')
        queue.abort()
        logger.debug('Done')
      })
    }, 1000)
    try {
      await worker.run()
    } catch (err) {
    }
    assert.ok(await actorStorage.isInCollection(testUsernames[0], 'inbox', activity))
    assert.ok(await actorStorage.isInCollection(testUsernames[1], 'inbox', activity))
    assert.ok(true)
  })
})
