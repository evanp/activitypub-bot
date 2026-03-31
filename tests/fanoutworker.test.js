import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import {
  nockSetup,
  nockFormat,
  postInbox,
  resetInbox
} from '@evanp/activitypub-nock'

import as2 from '../lib/activitystreams.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { DistributionWorker } from '../lib/distributionworker.js'
import { JobQueue } from '../lib/jobqueue.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('FanoutWorker', async () => {
  const localHost = 'local.fanoutworker.test'
  const remoteHost = 'remote.fanoutworker.test'
  const origin = `https://${localHost}`
  const testUsernames = ['fanoutworkertest1']
  const remoteUsernames = ['fanoutworkerremote1']
  let connection
  let formatter
  let logger
  let client
  let actorStorage
  let distributor
  let FanoutWorker
  let fanoutWorker
  let distributionWorker
  let queue

  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter(origin)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost],
      queues: ['fanout', 'distribution']
    })
    actorStorage = new ActorStorage(connection, formatter)
    const keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    const limiter = new RateLimiter(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, remoteObjectCache)
    queue = new JobQueue(connection, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger, queue)
    nockSetup(remoteHost)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost],
      queues: ['fanout', 'distribution']
    })
    await connection.close()
    connection = null
    formatter = null
    logger = null
    client = null
    actorStorage = null
    distributor = null
    FanoutWorker = null
    fanoutWorker = null
    distributionWorker = null
    queue = null
  })

  beforeEach(() => {
    resetInbox()
  })

  it('can import the library', async () => {
    FanoutWorker = (await import('../lib/fanoutworker.js')).FanoutWorker
    assert.ok(FanoutWorker)
    assert.equal(typeof FanoutWorker, 'function')
  })

  it('can initialize', async () => {
    fanoutWorker = new FanoutWorker(queue, logger, { distributor })
    assert.ok(fanoutWorker)
  })

  it('can initialize a distribution worker', async () => {
    distributionWorker = new DistributionWorker(queue, logger, { client })
    assert.ok(distributionWorker)
  })

  it('can fanout to a remote actor', async () => {
    const username = testUsernames[0]
    const actorId = formatter.format({ username })
    const id = formatter.format({
      username,
      type: 'activity',
      nanoid: 'fanoutworkertest1234567'
    })
    const remoteActorId = nockFormat({
      username: remoteUsernames[0],
      domain: remoteHost
    })
    const activity = await as2.import({
      id,
      type: 'Activity',
      actor: { id: actorId },
      to: [remoteActorId]
    })
    const raw = await activity.export()
    await queue.enqueue('fanout', { activity: raw, username })
    setTimeout(() => {
      Promise.all([
        queue.onIdle('fanout'),
        queue.onIdle('distribution')
      ]).then(() => {
        fanoutWorker.stop()
        distributionWorker.stop()
        queue.abort()
      })
    }, 1000)
    try {
      await Promise.all([
        fanoutWorker.run(),
        distributionWorker.run()
      ])
    } catch (err) {}
    assert.ok(postInbox[remoteUsernames[0]])
  })
})
