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
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { JobQueue } from '../lib/jobqueue.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('DistributionWorker', async () => {
  const localHost = 'local.distributionworker.test'
  const remoteHost = 'remote.distributionworker.test'
  const origin = `https://${localHost}`
  const testUsernames = ['distributionworkertest1', 'distributionworkertest2']
  const remoteUsernames = ['distributionworkerremote1']
  let connection
  let formatter
  let logger
  let client
  let DistributionWorker
  let worker
  let queue

  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter(origin)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost]
    })
    const keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    const limiter = new RateLimiter(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, remoteObjectCache)
    queue = new JobQueue(connection, logger)
    nockSetup(remoteHost)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost]
    })
    await connection.close()
    connection = null
    formatter = null
    logger = null
    client = null
    DistributionWorker = null
    worker = null
  })

  beforeEach(() => {
    resetInbox()
  })

  it('can import the library', async () => {
    DistributionWorker = (await import('../lib/distributionworker.js')).DistributionWorker
    assert.ok(DistributionWorker)
    assert.equal(typeof DistributionWorker, 'function')
  })

  it('can initialize', async () => {
    worker = new DistributionWorker(queue, logger, { client })
    assert.ok(worker)
  })

  it('can run a little bit', async () => {
    const username = testUsernames[0]
    const attributedTo = formatter.format({ username })
    const id = formatter.format({
      username,
      type: 'Activity',
      nanoid: 'ryhsUbu1QTjrBrlS8TNjs'
    })
    const remoteActor = nockFormat({
      username: remoteUsernames[0],
      domain: remoteHost
    })
    const activity = await as2.import({
      attributedTo,
      id,
      type: 'Activity',
      to: remoteActor
    })
    const json = await activity.export()
    const inbox = nockFormat({
      username: remoteUsernames[0],
      collection: 'inbox',
      domain: remoteHost
    })
    await queue.enqueue('distribution', { inbox, activity: json, username })
    setTimeout(() => {
      queue.onIdle('distribution').then(() => {
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
    assert.ok(postInbox[remoteUsernames[0]])
  })
})
