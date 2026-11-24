import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'

import request from 'supertest'
import { nockMessageSignature } from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'
import BotFactory from '../lib/botfactory.js'
import as2 from '../lib/activitystreams.js'
import { Worker } from '../lib/worker.js'
import { JobReaper } from '../lib/jobreaper.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASIC_BLOCKLIST = resolve(__dirname, 'fixtures', 'blocklist-basic.csv')

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('app', async () => {
  const LOCAL_HOST = 'local.app.test'
  const origin = `https://${LOCAL_HOST}`
  const BOT_USERNAME = 'apptestbot1'
  const TEST_USERNAMES = [BOT_USERNAME]
  const testBots = {
    [BOT_USERNAME]: new DoNothingBot(BOT_USERNAME)
  }
  const databaseUrl = getTestDatabaseUrl()
  const redisUrl = getTestRedisUrl()
  let app = null

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl,
      origin,
      bots: testBots,
      logLevel: 'silent',
      redisUrl,
      domainBlockFileName: BASIC_BLOCKLIST
    })
    await app.startWorkers()
    await app.initializeNetwork()
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      domainBlockFiles: [BASIC_BLOCKLIST],
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
    await app.cleanup()
  })

  it('should be a function', async () => {
    assert.strictEqual(typeof makeApp, 'function')
  })
  it('should return a function', async () => {
    assert.strictEqual(typeof app, 'function')
  })
  it('serves the installed component bundle with cache revalidation', async () => {
    const response = await request(app).get('/js/ap-components.min.js').expect(200)
    assert.match(response.headers['content-type'], /javascript/)
    assert.match(response.headers['cache-control'], /max-age=0/)
    assert.ok(response.headers.etag)
    const source = await readFile(fileURLToPath(import.meta.resolve('@socialwebfoundation/ap-components/dist/ap-components.min.js')), 'utf8')
    assert.strictEqual(response.text, source)
    await request(app).get('/js/ap-components.min.js')
      .set('If-None-Match', response.headers.etag).expect(304)
  })
  it('loads profile components from the local bundle', async () => {
    const response = await request(app).get(`/profile/${BOT_USERNAME}`).expect(200)
    assert.match(response.text, /import \{ ActivityPubElement \} from "\/js\/ap-components.min.js"/)
    assert.doesNotMatch(response.text, /unpkg\.com|cdn\.jsdelivr\.net/)
    assert.doesNotMatch(response.text, /<script[^>]+src=/)
  })
  it('does not expose other dependency files under /js/', async () => {
    await request(app).get('/js/package.json').expect(404)
    await request(app).get('/js/index.js').expect(404)
  })
  it('does not authenticate signed requests to missing routes', async (t) => {
    const keyLookup = t.mock.method(app.locals.remoteKeyStorage, 'getPublicKey', async () => null)
    const path = '/api/v1/instance'
    const headers = await nockMessageSignature({
      username: 'apptestremote1',
      domain: 'remote.app.test',
      url: `${origin}${path}`
    })

    const response = await request(app).get(path)
      .set('Host', LOCAL_HOST)
      .set('Accept', 'application/activity+json')
      .set(headers)

    assert.strictEqual(keyLookup.mock.callCount(), 0, 'missing routes must not fetch remote signing keys')
    assert.strictEqual(response.status, 404)
  })

  it('should not allow private network requests by default', async () => {
    assert.strictEqual(app.locals.client.allowPrivateNetworkRequests, false)
  })

  it('Creates an X-Request-ID', async () => {
    const response = await request(app).get('/readyz')
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers['x-request-id'])
    assert.ok(response.headers['x-request-id'].match(UUID_REGEXP))
  })

  it('Passes through an X-Request-ID', async () => {
    const id = 'FB726EB1-F325-47E4-93A0-C28A2517DC2A'
    const response = await request(app).get('/readyz')
      .set('X-Request-ID', id)
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers['x-request-id'])
    assert.strictEqual(response.headers['x-request-id'], id)
    assert.ok(response.headers['x-request-id'].match(UUID_REGEXP))
  })

  it('Ignores a non-UUID X-Request-ID', async () => {
    const id = 'not a UUID'
    const response = await request(app).get('/readyz')
      .set('X-Request-ID', id)
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers['x-request-id'])
    assert.ok(response.headers['x-request-id'] !== id)
    assert.ok(response.headers['x-request-id'].match(UUID_REGEXP))
  })

  it('Does not include X-Powered-By header', async () => {
    const response = await request(app).get('/readyz')
    assert.strictEqual(response.status, 200)
    assert.ok(!response.headers['x-powered-by'])
  })

  it('includes RateLimit headers on GET responses', async () => {
    const response = await request(app).get('/readyz')
    assert.strictEqual(response.status, 200)
    assert.ok(response.headers.ratelimit)
    assert.ok(response.headers['ratelimit-policy'])
  })

  it('includes RateLimit headers on POST responses', async () => {
    const response = await request(app)
      .post(`/user/${BOT_USERNAME}/inbox`)
      .set('Content-Type', 'application/activity+json')
      .send({})
    // We expect a 4xx (no signature, etc.) but headers should still be present
    assert.ok(response.headers.ratelimit)
    assert.ok(response.headers['ratelimit-policy'])
  })

  it('returns 429 when GET burst rate limit is exceeded', async () => {
    const burstLimit = 1000
    const requests = Array.from(
      { length: burstLimit + 1 },
      () => request(app).get('/readyz')
    )
    const responses = await Promise.all(requests)
    const rateLimited = responses.filter(r => r.status === 429)
    assert.ok(rateLimited.length > 0, 'Expected at least one 429 response')
    const limited = rateLimited[0]
    assert.strictEqual(limited.headers['content-type'], 'application/problem+json; charset=utf-8')
    assert.strictEqual(limited.body.status, 429)
    assert.strictEqual(limited.body.type, 'about:blank')
    assert.ok(limited.body.title)
    assert.ok(limited.body.detail)
    assert.ok(limited.headers['retry-after'])
  })

  it('allows private network requests when the override is set', async () => {
    const overrideHost = 'private-network-override.app.test'
    const overrideOrigin = `https://${overrideHost}`
    const overrideUsername = 'apptestbot2'
    const overrideApp = await makeApp({
      databaseUrl,
      origin: overrideOrigin,
      bots: {
        [overrideUsername]: new DoNothingBot(overrideUsername)
      },
      logLevel: 'silent',
      allowPrivateNetworkRequests: true,
      redisUrl
    })
    try {
      await overrideApp.startWorkers()
      await overrideApp.initializeNetwork()
      await cleanupTestData(overrideApp.locals.connection, {
        usernames: [overrideUsername],
        localDomain: overrideHost
      })
      assert.strictEqual(overrideApp.locals.client.allowPrivateNetworkRequests, true)
    } finally {
      await cleanupTestData(overrideApp.locals.connection, {
        usernames: [overrideUsername],
        localDomain: overrideHost
      })
      await overrideApp.cleanup()
    }
  })

  it('puts a domain blocker on app.locals', async () => {
    assert.strictEqual(typeof app.locals.domainBlocker, 'object')
    assert.ok(app.locals.domainBlocker)
  })

  it('has initialized the domain blocker from the file', async () => {
    assert.strictEqual(
      await app.locals.domainBlocker.isBlocked('https://blocked-one.test/users/alice'),
      true
    )
  })

  it('does not block domains absent from the blocklist file', async () => {
    assert.strictEqual(
      await app.locals.domainBlocker.isBlocked('https://allowed.test/users/carol'),
      false
    )
  })
})

describe('app lifecycle', { timeout: 30000 }, () => {
  const host = 'startup.app.example'
  const origin = `https://${host}`
  const username = 'startupbot'

  const makeLifecycleApp = (bots = { [username]: new DoNothingBot(username) }) => makeApp({
    databaseUrl: 'sqlite::memory:',
    origin,
    bots,
    logLevel: 'silent',
    deliveryWorkerCount: 1,
    distributionWorkerCount: 1,
    fanoutWorkerCount: 1,
    intakeWorkerCount: 1
  })

  it('does not start workers or the job reaper during construction', async (t) => {
    const runs = t.mock.method(Worker.prototype, 'run')
    const reaperRuns = t.mock.method(JobReaper.prototype, 'run')
    const app = await makeLifecycleApp()
    t.after(() => app.cleanup())

    assert.strictEqual(runs.mock.callCount(), 0)
    assert.strictEqual(reaperRuns.mock.callCount(), 0)
  })

  it('starts each worker pool and the job reaper when requested', async (t) => {
    const runs = t.mock.method(Worker.prototype, 'run')
    const reaperRuns = t.mock.method(JobReaper.prototype, 'run')
    const app = await makeLifecycleApp()
    t.after(() => app.cleanup())

    await app.startWorkers()

    assert.deepStrictEqual(
      runs.mock.calls.map(call => call.this.constructor.name).sort(),
      ['DeliveryWorker', 'DistributionWorker', 'FanoutWorker', 'IntakeWorker']
    )
    assert.strictEqual(reaperRuns.mock.callCount(), 1)
  })

  it('does not start duplicate workers or reapers when called twice', async (t) => {
    const runs = t.mock.method(Worker.prototype, 'run')
    const reaperRuns = t.mock.method(JobReaper.prototype, 'run')
    const app = await makeLifecycleApp()
    t.after(() => app.cleanup())

    await app.startWorkers()
    await app.startWorkers()

    assert.strictEqual(runs.mock.callCount(), 4)
    assert.strictEqual(reaperRuns.mock.callCount(), 1)
  })

  it('processes queued activities after workers start', async (t) => {
    const bot = new DoNothingBot(username)
    const handled = t.mock.method(bot, 'handleActivity', async () => true)
    const app = await makeLifecycleApp({ [username]: bot })
    t.after(() => app.cleanup())
    const activity = await as2.import({
      id: `${origin}/activity/queued`,
      type: 'Activity',
      actor: `${origin}/user/sender`,
      to: bot._context.botActorId
    })

    await app.locals.deliverer.deliverTo(activity, bot)
    assert.strictEqual(handled.mock.callCount(), 0)
    assert.strictEqual(await app.locals.actorStorage.isInCollection(username, 'inbox', activity), false)

    await app.startWorkers()
    await app.onIdle()

    assert.strictEqual(handled.mock.callCount(), 1)
    assert.strictEqual(handled.mock.calls[0].arguments[0].id, activity.id)
    assert.strictEqual(await app.locals.actorStorage.isInCollection(username, 'inbox', activity), true)
  })

  it('can clean up without starting workers', async () => {
    const app = await makeLifecycleApp()

    await assert.doesNotReject(() => app.cleanup())
  })

  it('defers network initialization until requested and initializes every configured bot', async (t) => {
    const first = new DoNothingBot('firstbot')
    const second = new DoNothingBot('secondbot')
    const factory = new BotFactory()
    const contexts = []
    first.initializeNetwork = t.mock.fn(async function () {
      contexts.push(this._context)
    })
    second.initializeNetwork = t.mock.fn(async function () {
      contexts.push(this._context)
    })
    factory.initializeNetwork = t.mock.fn(async function () {
      contexts.push(this._context)
    })
    const app = await makeLifecycleApp({ firstbot: first, secondbot: second, '*': factory })
    t.after(() => app.cleanup())

    assert.strictEqual(first.initializeNetwork.mock.callCount(), 0)
    assert.strictEqual(second.initializeNetwork.mock.callCount(), 0)
    assert.strictEqual(factory.initializeNetwork.mock.callCount(), 0)
    for (const botId of ['firstbot', 'secondbot', host]) {
      const response = await request(app).get(`/user/${botId}`).expect(200)
      assert.strictEqual(response.body.id, `${origin}/user/${botId}`)
    }

    await app.startWorkers()
    assert.strictEqual(first.initializeNetwork.mock.callCount(), 0)
    assert.strictEqual(second.initializeNetwork.mock.callCount(), 0)
    assert.strictEqual(factory.initializeNetwork.mock.callCount(), 0)

    await app.initializeNetwork()

    assert.strictEqual(first.initializeNetwork.mock.callCount(), 1)
    assert.strictEqual(second.initializeNetwork.mock.callCount(), 1)
    assert.strictEqual(factory.initializeNetwork.mock.callCount(), 1)
    assert.deepStrictEqual(new Set(contexts), new Set([first._context, second._context, factory._context]))
    assert.strictEqual(first._context.botId, 'firstbot')
    assert.strictEqual(second._context.botId, 'secondbot')
    assert.strictEqual(factory._context.botId, '*')
  })

  it('waits for asynchronous network initialization to finish', { timeout: 5000 }, async (t) => {
    const entered = Promise.withResolvers()
    const release = Promise.withResolvers()
    const bot = new DoNothingBot(username)
    let finished = false
    bot.initializeNetwork = async () => {
      entered.resolve()
      await release.promise
      finished = true
    }
    const app = await makeLifecycleApp({ [username]: bot })
    t.after(() => app.cleanup())
    t.after(() => release.resolve())
    let settled = false
    const initialization = app.initializeNetwork().then(() => {
      settled = true
    })

    try {
      await Promise.race([entered.promise, initialization])
      await setImmediate()
      assert.strictEqual(settled, false)
      assert.strictEqual(finished, false)
    } finally {
      release.resolve()
    }
    await initialization

    assert.strictEqual(finished, true)
    assert.strictEqual(settled, true)
  })

  it('supports default network initialization with ordinary bots and wildcard factories', async (t) => {
    const bot = new DoNothingBot(username)
    const app = await makeLifecycleApp({ [username]: bot, '*': new BotFactory() })
    t.after(() => app.cleanup())

    assert.strictEqual(typeof bot.initializeNetwork, 'function')
    assert.strictEqual(typeof app.locals.bots[host].initializeNetwork, 'function')
    await assert.doesNotReject(async () => app.initializeNetwork())
  })

  it('propagates network initialization failures to the caller', async (t) => {
    const failure = new Error('Network initialization failed')
    const bot = new DoNothingBot(username)
    bot.initializeNetwork = async () => {
      throw failure
    }
    const app = await makeLifecycleApp({ [username]: bot })
    t.after(() => app.cleanup())

    await assert.rejects(async () => app.initializeNetwork(), err => err === failure)
  })
})
