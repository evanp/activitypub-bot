import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'

import nock from 'nock'
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
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'
import { JobQueue } from '../lib/jobqueue.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'
import { RecoverableError } from '../lib/worker.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('DistributionWorker', async () => {
  const localHost = 'local.distributionworker.test'
  const remoteHost = 'remote.distributionworker.test'
  const clientErrorHost = 'client-error.distributionworker.test'
  const retryAfterHost = 'retry-after.distributionworker.test'
  const recoverableServerHost = 'recoverable-server.distributionworker.test'
  const maxAttemptsHost = 'max-attempts.distributionworker.test'
  const unrecoverableServerHost = 'unrecoverable-server.distributionworker.test'
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

  function makePayload ({
    username = testUsernames[0],
    remoteUsername = remoteUsernames[0],
    domain = remoteHost,
    nanoid = 'ryhsUbu1QTjrBrlS8TNjs'
  } = {}) {
    const attributedTo = formatter.format({ username })
    const id = formatter.format({
      username,
      type: 'Activity',
      nanoid
    })
    const remoteActor = nockFormat({
      username: remoteUsername,
      domain
    })
    return as2.import({
      attributedTo,
      id,
      type: 'Activity',
      to: remoteActor
    }).then(async (activity) => {
      const json = await activity.export()
      const inbox = nockFormat({
        username: remoteUsername,
        collection: 'inbox',
        domain
      })
      return { inbox, activity: json, username }
    })
  }

  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter(origin)
    DistributionWorker = (await import('../lib/distributionworker.js')).DistributionWorker
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [
        remoteHost,
        clientErrorHost,
        retryAfterHost,
        recoverableServerHost,
        maxAttemptsHost,
        unrecoverableServerHost
      ]
    })
    const keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const messageSigner = new HTTPMessageSignature(logger)
    const digester = new Digester(logger)
    const limiter = new RateLimiter(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    const policyStorage = new SignaturePolicyStorage(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, remoteObjectCache, messageSigner, policyStorage)
    queue = new JobQueue(connection, logger)
    nockSetup(remoteHost)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: localHost,
      remoteDomains: [
        remoteHost,
        clientErrorHost,
        retryAfterHost,
        recoverableServerHost,
        maxAttemptsHost,
        unrecoverableServerHost
      ]
    })
    await connection.close()
  })

  beforeEach(() => {
    resetInbox()
    nock.cleanAll()
    nockSetup(remoteHost)
  })

  it('can import the library', async () => {
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

  describe('error handling', async () => {
    beforeEach(async () => {
      worker = new DistributionWorker(queue, logger, { client })
    })

    it('throws the original error when no HTTP status is available', async () => {
      const payload = await makePayload({
        nanoid: 'nostatus1234567890123'
      })
      const noStatusWorker = new DistributionWorker(queue, logger, {
        client: {
          async post () {
            throw new Error('network exploded')
          }
        }
      })

      await assert.rejects(
        noStatusWorker.doJob(payload, 1),
        error => error.message === 'network exploded'
      )
    })

    it('throws the original error on ordinary client errors', async () => {
      const payload = await makePayload({
        domain: clientErrorHost,
        nanoid: 'clienterror123456789'
      })

      nock(`https://${clientErrorHost}`)
        .post(`/user/${remoteUsernames[0]}/inbox`)
        .reply(404, 'not found')

      await assert.rejects(
        worker.doJob(payload, 1),
        error => error.status === 404
      )
    })

    it('retries recoverable client errors using retry-after', async () => {
      const payload = await makePayload({
        domain: retryAfterHost,
        nanoid: 'retryafter123456789'
      })

      nock(`https://${retryAfterHost}`)
        .post(`/user/${remoteUsernames[0]}/inbox`)
        .reply(429, 'too many requests', { 'retry-after': '12' })

      await assert.rejects(
        worker.doJob(payload, 1),
        error => {
          assert.ok(error instanceof RecoverableError)
          assert.strictEqual(error.delay, 12000)
          return true
        }
      )
    })

    it('retries recoverable server errors before max attempts', async () => {
      const payload = await makePayload({
        domain: recoverableServerHost,
        nanoid: 'recoverableserver123'
      })

      nock(`https://${recoverableServerHost}`)
        .post(`/user/${remoteUsernames[0]}/inbox`)
        .reply(503, 'service unavailable')

      await assert.rejects(
        worker.doJob(payload, 1),
        error => {
          assert.ok(error instanceof RecoverableError)
          assert.ok(error.delay > 0)
          return true
        }
      )
    })

    it('throws the original error on recoverable server errors at max attempts', async () => {
      const payload = await makePayload({
        domain: maxAttemptsHost,
        nanoid: 'maxattempts123456789'
      })

      nock(`https://${maxAttemptsHost}`)
        .post(`/user/${remoteUsernames[0]}/inbox`)
        .reply(503, 'service unavailable')

      await assert.rejects(
        worker.doJob(payload, 21),
        error => error.status === 503
      )
    })

    it('throws the original error on unrecoverable server errors', async () => {
      const payload = await makePayload({
        domain: unrecoverableServerHost,
        nanoid: 'unrecoverableserver1'
      })

      nock(`https://${unrecoverableServerHost}`)
        .post(`/user/${remoteUsernames[0]}/inbox`)
        .reply(501, 'not implemented')

      await assert.rejects(
        worker.doJob(payload, 1),
        error => error.status === 501
      )
    })
  })
})
