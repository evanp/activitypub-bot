import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import {
  nockSetup,
  nockFormat
} from '@evanp/activitypub-nock'

import as2 from '../lib/activitystreams.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { ActivityDeliverer } from '../lib/activitydeliverer.js'
import { ActivityHandler } from '../lib/activityhandler.js'
import { Authorizer } from '../lib/authorizer.js'
import { ObjectCache } from '../lib/objectcache.js'
import { DeliveryWorker } from '../lib/deliveryworker.js'
import { JobQueue } from '../lib/jobqueue.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import DoNothingBot from '../lib/bots/donothing.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('IntakeWorker', async () => {
  const localHost = 'local.intakeworker.test'
  const remoteHost = 'remote.intakeworker.test'
  const origin = `https://${localHost}`
  const testUsernames = ['intakeworkertest1']
  const remoteUsernames = ['intakeworkerremote1']
  const testBots = {
    [testUsernames[0]]: new DoNothingBot(testUsernames[0])
  }
  let connection
  let formatter
  let logger
  let client
  let actorStorage
  let objectStorage
  let deliverer
  let deliveryWorker
  let IntakeWorker
  let intakeWorker
  let queue

  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter(origin)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost],
      queues: ['intake', 'delivery']
    })
    actorStorage = new ActorStorage(connection, formatter)
    objectStorage = new ObjectStorage(connection)
    const keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const messageSigner = new HTTPMessageSignature(logger)
    const digester = new Digester(logger)
    const limiter = new RateLimiter(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    const policyStorage = new SignaturePolicyStorage(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, remoteObjectCache, messageSigner, policyStorage)
    queue = new JobQueue(connection, logger)
    const distributor = new ActivityDistributor(client, formatter, actorStorage, logger, queue)
    const authz = new Authorizer(actorStorage, formatter, client)
    const cache = new ObjectCache({ longTTL: 3600 * 1000, shortTTL: 300 * 1000, maxItems: 1000 })
    const handler = new ActivityHandler(
      actorStorage,
      objectStorage,
      distributor,
      formatter,
      cache,
      authz,
      logger,
      client
    )
    deliverer = new ActivityDeliverer(actorStorage, formatter, logger, client, queue)
    deliveryWorker = new DeliveryWorker(queue, logger, { actorStorage, activityHandler: handler, bots: testBots })
    nockSetup(remoteHost)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost],
      queues: ['intake', 'delivery']
    })
    await connection.close()
  })

  it('can import the library', async () => {
    IntakeWorker = (await import('../lib/intakeworker.js')).IntakeWorker
    assert.ok(IntakeWorker)
    assert.equal(typeof IntakeWorker, 'function')
  })

  it('can initialize', async () => {
    intakeWorker = new IntakeWorker(queue, logger, { deliverer, bots: testBots })
    assert.ok(intakeWorker)
  })

  it('can deliver an activity to a local bot', async () => {
    const remoteActorId = nockFormat({
      username: remoteUsernames[0],
      domain: remoteHost
    })
    const localActorId = formatter.format({ username: testUsernames[0] })
    const activity = await as2.import({
      id: nockFormat({ username: remoteUsernames[0], type: 'activity', nanoid: 'intakeworkertest12345', domain: remoteHost }),
      type: 'Activity',
      actor: { id: remoteActorId },
      to: [localActorId]
    })
    const raw = await activity.export()
    await queue.enqueue('intake', { activity: raw, subject: remoteActorId })
    setTimeout(() => {
      Promise.all([
        queue.onIdle('intake'),
        queue.onIdle('delivery')
      ]).then(() => {
        intakeWorker.stop()
        deliveryWorker.stop()
        queue.abort()
      })
    }, 1000)
    try {
      await Promise.all([
        intakeWorker.run(),
        deliveryWorker.run()
      ])
    } catch (err) {}
    assert.ok(await actorStorage.isInCollection(testUsernames[0], 'inbox', activity))
  })
})
