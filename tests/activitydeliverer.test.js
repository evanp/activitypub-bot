import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import as2 from '../lib/activitystreams.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'
import { JobQueue } from '../lib/jobqueue.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

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
    const messageSigner = new HTTPMessageSignature(logger)
    const digester = new Digester(logger)
    const limiter = new RateLimiter(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    const policyStorage = new SignaturePolicyStorage(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, remoteObjectCache, messageSigner, policyStorage)
    jobQueue = new JobQueue(connection, logger)
  })
  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [remoteHost]
    })
    await connection.close()
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

  it('can intake an activity', async () => {
    const subject = `https://${remoteHost}/users/intaketest1`
    const activity = await as2.import({
      id: `https://${remoteHost}/activity/intaketest1`,
      type: 'Activity',
      actor: { id: subject },
      to: [formatter.format({ username: testUsernames[0] })]
    })
    await deliverer.intake(activity, subject)
    const { jobId, payload } = await jobQueue.dequeue('intake', 'activitydeliverer.test')
    assert.ok(payload.activity)
    assert.strictEqual(payload.subject, subject)
    await jobQueue.complete(jobId, 'activitydeliverer.test')
  })
})
