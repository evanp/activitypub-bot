import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'

import {
  nockSetup,
  postInbox,
  resetInbox,
  nockFormat,
  getBody
} from '@evanp/activitypub-nock'
import Logger from 'pino'

import { BotContext } from '../lib/botcontext.js'
import { BotDataStorage } from '../lib/botdatastorage.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { SafeFetcher } from '../lib/safefetcher.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { EndpointCache } from '../lib/endpointcache.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { Transformer } from '../lib/microsyntax.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'
import { JobQueue } from '../lib/jobqueue.js'
import { DistributionWorker } from '../lib/distributionworker.js'
import { DeliveryWorker } from '../lib/deliveryworker.js'
import { FanoutWorker } from '../lib/fanoutworker.js'
import { ActivityHandler } from '../lib/activityhandler.js'
import { Authorizer } from '../lib/authorizer.js'
import { DomainBlocker } from '../lib/domainblocker.js'
import as2 from '../lib/activitystreams.js'
import { RequestThrottler } from '../lib/requestthrottler.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'
const LOCAL_HOST = 'local.bot-relayclient.test'
const REMOTE_HOST = 'remote.bot-relayclient.test'
const LOCAL_ORIGIN = `https://${LOCAL_HOST}`
const BOT_USERNAME = 'botrelayclienttest1'
const RELAY_USERNAME = 'botrelayclientrelay1'
const TEST_USERNAMES = [BOT_USERNAME]

function isRelayFollow (activity) {
  return activity.type === `${AS2_NS}Follow` &&
    activity.object.first.id === `${AS2_NS}Public`
}

function isRelayUnfollow (activity) {
  return activity.type === `${AS2_NS}Undo` &&
    activity.object.first.type === `${AS2_NS}Follow` &&
    activity.object.first.object.first.id === `${AS2_NS}Public`
}

describe('MastodonRelayClientBot', () => {
  const botName = BOT_USERNAME
  let connection = null
  let botDataStorage = null
  let objectStorage = null
  let keyStorage = null
  let actorStorage = null
  let formatter = null
  let client = null
  let distributor = null
  let context = null
  let transformer = null
  let safeFetcher = null
  let logger = null
  let MastodonRelayClientBot = null
  let relay = null
  let bot = null
  let jobQueue
  let distributionWorker
  let distributionWorkerRun
  let fanoutWorker
  let fanoutWorkerRun
  let deliveryWorker
  let deliveryWorkerRun
  const bots = {}
  let authz
  let cache
  let handler

  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    formatter = new UrlFormatter(LOCAL_ORIGIN)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    botDataStorage = new BotDataStorage(connection)
    objectStorage = new ObjectStorage(connection)
    keyStorage = new KeyStorage(connection, logger)
    actorStorage = new ActorStorage(connection, formatter)
    const signer = new HTTPSignature(logger)
    const messageSigner = new HTTPMessageSignature(logger)
    const digester = new Digester(logger)
    const throttler = new RequestThrottler(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    const policyStorage = new SignaturePolicyStorage(connection, logger)
    safeFetcher = new SafeFetcher()
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, throttler, remoteObjectCache, messageSigner, policyStorage, safeFetcher)
    jobQueue = new JobQueue(connection, logger)
    const endpointCache = new EndpointCache(connection, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger, jobQueue, endpointCache, new DomainBlocker(null, connection, logger))
    distributionWorker = new DistributionWorker(jobQueue, logger, { client })
    distributionWorkerRun = distributionWorker.run()
    fanoutWorker = new FanoutWorker(jobQueue, logger, { distributor })
    fanoutWorkerRun = fanoutWorker.run()
    transformer = new Transformer(`${LOCAL_ORIGIN}/tag/`, client, safeFetcher, formatter)
    authz = new Authorizer(actorStorage, formatter, client, new DomainBlocker(null, connection, logger))
    cache = new RemoteObjectCache(connection, logger)
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
    deliveryWorker = new DeliveryWorker(jobQueue, logger, { actorStorage, activityHandler: handler, bots })
    deliveryWorkerRun = deliveryWorker.run()
    context = new BotContext(
      botName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )
    nockSetup(REMOTE_HOST)
    relay = nockFormat({ username: RELAY_USERNAME, domain: REMOTE_HOST })
  })
  after(async () => {
    jobQueue.abort()
    fanoutWorker.stop()
    deliveryWorker.stop()
    distributionWorker.stop()
    await Promise.allSettled([fanoutWorkerRun, distributionWorkerRun, deliveryWorkerRun])
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await connection.close()
  })
  beforeEach(async () => {
    resetInbox()
  })

  it('can be imported', async () => {
    MastodonRelayClientBot = (await import('../lib/bots/mastodonrelayclient.js')).default
    assert.ok(MastodonRelayClientBot)
    assert.equal(typeof MastodonRelayClientBot, 'function')
  })

  it('can be constructed', async () => {
    bot = new MastodonRelayClientBot(botName, { relay })
    assert.ok(bot)
    bots[botName] = bot
  })

  it('subscribes to a remote relay on initialize', async () => {
    await bot.initialize(context)
    await context.onIdle()
    assert.equal(postInbox[RELAY_USERNAME], 1)

    let foundInOutbox = false

    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      foundInOutbox = isRelayFollow(activity)
      if (foundInOutbox) {
        break
      }
    }

    assert.ok(foundInOutbox)

    let foundInInbox = false

    for await (const item of actorStorage.items(botName, 'inbox')) {
      const activity = await objectStorage.read(item.id)
      foundInInbox = isRelayFollow(activity)
      if (foundInInbox) {
        break
      }
    }

    assert.ok(foundInInbox)
  })

  it('handles an Accept activity for the relay follow', async () => {
    const inbox = nockFormat({
      username: RELAY_USERNAME,
      collection: 'inbox',
      domain: REMOTE_HOST
    })
    const body = getBody(inbox)
    assert.ok(body)
    const follow = JSON.parse(body)
    const accept = await as2.import({
      type: 'Accept',
      id: nockFormat({
        username: RELAY_USERNAME,
        type: 'Accept',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: nockFormat({
        username: RELAY_USERNAME,
        domain: REMOTE_HOST
      }),
      to: formatter.format({ username: BOT_USERNAME }),
      object: {
        id: follow.id,
        type: follow.type,
        object: follow.object
      }
    })
    const handled = await bot.handleActivity(accept)
    assert.strictEqual(handled, true)
  })

  it('handles a Reject activity for the relay follow', async () => {
    const inbox = nockFormat({
      username: RELAY_USERNAME,
      collection: 'inbox',
      domain: REMOTE_HOST
    })
    const body = getBody(inbox)
    assert.ok(body)
    const follow = JSON.parse(body)
    const reject = await as2.import({
      type: 'Reject',
      id: nockFormat({
        username: RELAY_USERNAME,
        type: 'Reject',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: nockFormat({
        username: RELAY_USERNAME,
        domain: REMOTE_HOST
      }),
      to: formatter.format({ username: BOT_USERNAME }),
      object: {
        id: follow.id,
        type: follow.type,
        object: follow.object
      }
    })
    const handled = await bot.handleActivity(reject)
    assert.strictEqual(handled, true)
  })

  it('has actor type Application', async () => {
    assert.strictEqual(bot.type, 'Application')
  })

  it('adds the relay actor to the following collection on Accept', async () => {
    const followingBotName = 'botrelayclienttestfollowing'
    const followingRelayUsername = 'botrelayclienttestfollowingrelay'
    const followingRelay = nockFormat({
      username: followingRelayUsername,
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(followingBotName)

    const followingContext = new BotContext(
      followingBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )
    const followingBot = new MastodonRelayClientBot(followingBotName, {
      relay: followingRelay
    })
    bots[followingBotName] = followingBot

    await followingBot.initialize(followingContext)
    await followingContext.onIdle()

    const inbox = nockFormat({
      username: followingRelayUsername,
      collection: 'inbox',
      domain: REMOTE_HOST
    })
    const body = getBody(inbox)
    assert.ok(body, 'expected a Follow to have been posted to the relay')
    const follow = JSON.parse(body)
    const accept = await as2.import({
      type: 'Accept',
      id: nockFormat({
        username: followingRelayUsername,
        type: 'Accept',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: followingRelay,
      to: formatter.format({ username: followingBotName }),
      object: {
        id: follow.id,
        type: follow.type,
        object: follow.object
      }
    })
    await followingBot.handleActivity(accept)

    assert.ok(
      await actorStorage.isInCollection(
        followingBotName, 'following', { id: followingRelay }
      ),
      'relay actor should be in the bot\'s following collection after Accept'
    )
  })

  it('calls onPublic on other bots when an Announce arrives from the subscribed relay', async () => {
    const announceBotName = 'botrelayclienttestannounce'
    const announceRelayUsername = 'botrelayclienttestannouncerelay'
    const announceRelay = nockFormat({
      username: announceRelayUsername,
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(announceBotName)

    const announceContext = new BotContext(
      announceBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )
    const announceBot = new MastodonRelayClientBot(announceBotName, {
      relay: announceRelay
    })
    bots[announceBotName] = announceBot

    await announceBot.initialize(announceContext)
    await announceContext.onIdle()

    const inbox = nockFormat({
      username: announceRelayUsername,
      collection: 'inbox',
      domain: REMOTE_HOST
    })
    const follow = JSON.parse(getBody(inbox))
    const accept = await as2.import({
      type: 'Accept',
      id: nockFormat({
        username: announceRelayUsername,
        type: 'Accept',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: announceRelay,
      to: formatter.format({ username: announceBotName }),
      object: {
        id: follow.id,
        type: follow.type,
        object: follow.object
      }
    })
    await announceBot.handleActivity(accept)

    const spyCalls = []
    const spyBotName = 'botrelayclienttestspy'
    bots[spyBotName] = {
      id: formatter.format({ username: spyBotName }),
      username: spyBotName,
      onPublic: async (activity) => {
        spyCalls.push(activity)
      }
    }

    const announce = await as2.import({
      type: 'Announce',
      id: nockFormat({
        username: announceRelayUsername,
        type: 'Announce',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: announceRelay,
      object: `https://${REMOTE_HOST}/user/otherperson/statuses/1`,
      to: `${announceRelay}/followers`
    })
    await announceBot.handleActivity(announce)

    assert.strictEqual(
      spyCalls.length,
      1,
      'spy bot onPublic should be called exactly once'
    )
    const received = spyCalls[0]
    const receivedId = received.id?.first?.id ?? received.id
    const expectedId = announce.id?.first?.id ?? announce.id
    assert.strictEqual(receivedId, expectedId)
  })

  it('subscribes to multiple relays when relay is an array', async () => {
    const multiBotName = 'botmastodonrelayclienttestmulti'
    const multiA = nockFormat({
      username: 'botmastodonrelaymultia',
      domain: REMOTE_HOST
    })
    const multiB = nockFormat({
      username: 'botmastodonrelaymultib',
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(multiBotName)

    const multiContext = new BotContext(
      multiBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )
    const multiBot = new MastodonRelayClientBot(multiBotName, {
      relay: [multiA, multiB]
    })
    bots[multiBotName] = multiBot
    await multiBot.initialize(multiContext)
    await multiContext.onIdle()

    let foundA = false
    let foundB = false
    for await (const item of actorStorage.items(multiBotName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (!isRelayFollow(activity)) continue
      const toId = activity.to?.first?.id
      if (toId === multiA) foundA = true
      if (toId === multiB) foundB = true
    }
    assert.ok(foundA, 'should have followed relay A')
    assert.ok(foundB, 'should have followed relay B')
  })

  it('unfollows relays no longer in the relay config on initialize', async () => {
    const diffBotName = 'botmastodonrelayclienttestdiff'
    const persistRelay = nockFormat({
      username: 'botmastodonrelaypersist',
      domain: REMOTE_HOST
    })
    const removedRelay = nockFormat({
      username: 'botmastodonrelayremoved',
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(diffBotName)

    const diffContext = new BotContext(
      diffBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )

    let diffBot = new MastodonRelayClientBot(diffBotName, {
      relay: [persistRelay, removedRelay]
    })
    bots[diffBotName] = diffBot
    await diffBot.initialize(diffContext)
    await diffContext.onIdle()

    // Simulate Accepts having arrived: both relays are in following.
    const persistActor = await as2.import({ id: persistRelay })
    const removedActor = await as2.import({ id: removedRelay })
    await actorStorage.addToCollection(diffBotName, 'following', persistActor)
    await actorStorage.addToCollection(diffBotName, 'following', removedActor)

    diffBot = new MastodonRelayClientBot(diffBotName, {
      relay: [persistRelay]
    })
    bots[diffBotName] = diffBot
    await diffBot.initialize(diffContext)
    await diffContext.onIdle()

    let foundRemovedUndo = false
    for await (const item of actorStorage.items(diffBotName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (!isRelayUnfollow(activity)) continue
      if (activity.to?.first?.id === removedRelay) {
        foundRemovedUndo = true
        break
      }
    }
    assert.ok(
      foundRemovedUndo,
      'should have sent an Undo Follow addressed to the removed relay'
    )
    assert.strictEqual(
      await actorStorage.isInCollection(
        diffBotName, 'following', removedActor
      ),
      false,
      'removed relay should no longer be in following'
    )
    assert.strictEqual(
      await actorStorage.isInCollection(
        diffBotName, 'following', persistActor
      ),
      true,
      'persistent relay should still be in following'
    )
  })

  it('is idempotent when re-initialized with the same relay config', async () => {
    const stableBotName = 'botmastodonrelayclientteststable'
    const stableRelay = nockFormat({
      username: 'botmastodonrelaystable',
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(stableBotName)

    const stableContext = new BotContext(
      stableBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )
    const stableBot = new MastodonRelayClientBot(stableBotName, {
      relay: [stableRelay]
    })
    bots[stableBotName] = stableBot

    await stableBot.initialize(stableContext)
    await stableContext.onIdle()

    let firstCount = 0
    for await (const item of actorStorage.items(stableBotName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (!isRelayFollow(activity)) continue
      if (activity.to?.first?.id === stableRelay) firstCount++
    }
    assert.ok(firstCount > 0, 'first initialize should send at least one Follow')

    await stableBot.initialize(stableContext)
    await stableContext.onIdle()

    let secondCount = 0
    for await (const item of actorStorage.items(stableBotName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (!isRelayFollow(activity)) continue
      if (activity.to?.first?.id === stableRelay) secondCount++
    }
    assert.strictEqual(
      secondCount,
      firstCount,
      're-initializing with the same config should not send extra Follows'
    )
  })

  it('can be constructed with a forceUnsubscribe option', async () => {
    const forceBotName = 'botmastodonrelayclienttestforce'
    const forceRelay = nockFormat({
      username: 'botmastodonrelayforce',
      domain: REMOTE_HOST
    })
    const forceUnsub = nockFormat({
      username: 'botmastodonrelayforceunsub',
      domain: REMOTE_HOST
    })
    const forceBot = new MastodonRelayClientBot(forceBotName, {
      relay: [forceRelay],
      forceUnsubscribe: [forceUnsub]
    })
    assert.ok(forceBot)
  })

  it('throws when a relay appears in both relay and forceUnsubscribe', async () => {
    const sharedRelay = nockFormat({
      username: 'botmastodonrelayshared',
      domain: REMOTE_HOST
    })
    assert.throws(() => {
      // eslint-disable-next-line no-new
      new MastodonRelayClientBot('botmastodonrelayclienttestshared', {
        relay: [sharedRelay],
        forceUnsubscribe: [sharedRelay]
      })
    })
  })

  it('sends an Undo referencing the stored Follow for a forceUnsubscribe relay with a stored Follow', async () => {
    const fuBotName = 'botmastodonrelayclienttestfu'
    const pendingRelay = nockFormat({
      username: 'botmastodonrelaypending',
      domain: REMOTE_HOST
    })
    const liveRelay = nockFormat({
      username: 'botmastodonrelaylive',
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(fuBotName)

    const fuContext = new BotContext(
      fuBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )

    // First run: subscribe so the Follow activity is stored. No Accept arrives,
    // so the relay is a pending subscription that never enters `following`.
    let fuBot = new MastodonRelayClientBot(fuBotName, { relay: [pendingRelay] })
    bots[fuBotName] = fuBot
    await fuBot.initialize(fuContext)
    await fuContext.onIdle()

    let followId = null
    for await (const item of actorStorage.items(fuBotName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (!isRelayFollow(activity)) continue
      if (activity.to?.first?.id === pendingRelay) {
        followId = activity.id?.first?.id ?? activity.id
        break
      }
    }
    assert.ok(followId, 'first initialize should have stored a Follow to the relay')

    // Second run: keep a separate live relay, force-unsubscribe the pending one.
    fuBot = new MastodonRelayClientBot(fuBotName, {
      relay: [liveRelay],
      forceUnsubscribe: [pendingRelay]
    })
    bots[fuBotName] = fuBot
    await fuBot.initialize(fuContext)
    await fuContext.onIdle()

    let undo = null
    for await (const item of actorStorage.items(fuBotName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (!isRelayUnfollow(activity)) continue
      if (activity.to?.first?.id === pendingRelay) {
        undo = activity
        break
      }
    }
    assert.ok(
      undo,
      'should have sent an Undo addressed to the forceUnsubscribe relay'
    )
    assert.strictEqual(
      undo.object.first.id,
      followId,
      'the Undo should reference the original stored Follow activity'
    )
  })

  it('sends a best-effort Undo with no Follow id when a forceUnsubscribe relay has no stored Follow', async () => {
    const neverBotName = 'botmastodonrelayclienttestnever'
    const neverRelay = nockFormat({
      username: 'botmastodonrelaynever',
      domain: REMOTE_HOST
    })
    const liveRelay = nockFormat({
      username: 'botmastodonrelayneverlive',
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(neverBotName)

    const neverContext = new BotContext(
      neverBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots,
      safeFetcher
    )
    const neverBot = new MastodonRelayClientBot(neverBotName, {
      relay: [liveRelay],
      forceUnsubscribe: [neverRelay]
    })
    bots[neverBotName] = neverBot

    await neverBot.initialize(neverContext)
    await neverContext.onIdle()

    let undo = null
    for await (const item of actorStorage.items(neverBotName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (!isRelayUnfollow(activity)) continue
      if (activity.to?.first?.id === neverRelay) {
        undo = activity
        break
      }
    }
    assert.ok(
      undo,
      'should have sent a best-effort Undo addressed to the forceUnsubscribe relay'
    )
    assert.ok(
      !undo.object.first.id,
      'the best-effort Undo should embed a Follow with no id'
    )
    assert.strictEqual(
      undo.object.first.actor?.first?.id,
      formatter.format({ username: neverBotName }),
      'the embedded Follow should identify the bot as the actor'
    )
  })
})
