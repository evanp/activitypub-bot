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
import { SafeAgent } from '../lib/safeagent.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
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
import { ObjectCache } from '../lib/objectcache.js'
import as2 from '../lib/activitystreams.js'
import { RequestThrottler } from '../lib/requestthrottler.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'
const LOCAL_HOST = 'local.bot-litepubrelayclient.test'
const REMOTE_HOST = 'remote.bot-litepubrelayclient.test'
const LOCAL_ORIGIN = `https://${LOCAL_HOST}`
const BOT_USERNAME = 'botlitepubrelayclienttest1'
const RELAY_USERNAME = 'botlitepubrelayclientrelay1'
const TEST_USERNAMES = [BOT_USERNAME]

function isRelayFollow (activity, relayId) {
  return activity.type === `${AS2_NS}Follow` &&
    activity.object?.first?.id === relayId
}

function isRelayUnfollow (activity, relayId) {
  return activity.type === `${AS2_NS}Undo` &&
    activity.object?.first?.type === `${AS2_NS}Follow` &&
    activity.object?.first?.object?.first?.id === relayId
}

describe('LitePubRelayClientBot', () => {
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
  let logger = null
  let LitePubRelayClientBot = null
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
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, throttler, remoteObjectCache, messageSigner, policyStorage, new SafeAgent())
    jobQueue = new JobQueue(connection, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger, jobQueue)
    distributionWorker = new DistributionWorker(jobQueue, logger, { client })
    distributionWorkerRun = distributionWorker.run()
    fanoutWorker = new FanoutWorker(jobQueue, logger, { distributor })
    fanoutWorkerRun = fanoutWorker.run()
    transformer = new Transformer(`${LOCAL_ORIGIN}/tag/`, client)
    authz = new Authorizer(actorStorage, formatter, client)
    cache = new ObjectCache({ longTTL: 3600 * 1000, shortTTL: 300 * 1000, maxItems: 1000 })
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
      bots
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
    LitePubRelayClientBot = (await import('../lib/bots/litepubrelayclient.js')).default
    assert.ok(LitePubRelayClientBot)
    assert.equal(typeof LitePubRelayClientBot, 'function')
  })

  it('can be constructed', async () => {
    bot = new LitePubRelayClientBot(botName, { relay })
    assert.ok(bot)
    bots[botName] = bot
  })

  it('has actor type Application', async () => {
    assert.strictEqual(bot.type, 'Application')
  })

  it('subscribes to a remote relay on initialize', async () => {
    await bot.initialize(context)
    await context.onIdle()
    assert.equal(postInbox[RELAY_USERNAME], 1)

    let foundInOutbox = false

    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      foundInOutbox = isRelayFollow(activity, relay)
      if (foundInOutbox) {
        break
      }
    }

    assert.ok(foundInOutbox)

    let foundInInbox = false

    for await (const item of actorStorage.items(botName, 'inbox')) {
      const activity = await objectStorage.read(item.id)
      foundInInbox = isRelayFollow(activity, relay)
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
      actor: relay,
      to: formatter.format({ username: BOT_USERNAME }),
      object: {
        id: follow.id,
        type: follow.type,
        object: follow.object
      }
    })
    await handler.handleActivity(bot, accept)
    assert.ok(
      await actorStorage.isInCollection(BOT_USERNAME, 'following', { id: relay })
    )
  })

  it('handles a Reject activity for a relay follow', async () => {
    const rejectRelayUsername = 'botlitepubrelayclientrelay2'
    const rejectRelay = nockFormat({
      username: rejectRelayUsername,
      domain: REMOTE_HOST
    })
    const followId = formatter.format({
      username: BOT_USERNAME,
      type: 'follow',
      nanoid: 'rejecttest1'
    })
    const follow = await as2.import({
      type: 'Follow',
      id: followId,
      actor: formatter.format({ username: BOT_USERNAME }),
      object: rejectRelay,
      to: rejectRelay
    })
    await objectStorage.create(follow)
    await actorStorage.addToCollection(BOT_USERNAME, 'pendingFollowing', follow)

    const reject = await as2.import({
      type: 'Reject',
      id: nockFormat({
        username: rejectRelayUsername,
        type: 'Reject',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: rejectRelay,
      to: formatter.format({ username: BOT_USERNAME }),
      object: {
        id: follow.id,
        type: 'Follow',
        object: rejectRelay
      }
    })
    await handler.handleActivity(bot, reject)
    assert.ok(
      !(await actorStorage.isInCollection(BOT_USERNAME, 'pendingFollowing', follow))
    )
    assert.ok(
      !(await actorStorage.isInCollection(BOT_USERNAME, 'following', { id: rejectRelay }))
    )
  })

  it('announces the object of a local public Create in onPublic', async () => {
    const authorUsername = 'botlitepubrelayclientauthor1'
    const authorId = formatter.format({ username: authorUsername })
    const noteId = formatter.format({
      username: authorUsername,
      type: 'note',
      nanoid: 'localnote1'
    })
    const createId = formatter.format({
      username: authorUsername,
      type: 'create',
      nanoid: 'localcreate1'
    })
    const create = await as2.import({
      type: 'Create',
      id: createId,
      actor: authorId,
      to: 'as:Public',
      object: {
        type: 'Note',
        id: noteId,
        attributedTo: authorId,
        content: 'hello from a LitePub relay client test',
        to: 'as:Public'
      }
    })
    const relayActor = await context.getObject(relay)
    await actorStorage.addToCollection(botName, 'followers', relayActor)
    await bot.onPublic(create)
    await context.onIdle()

    let foundInOutbox = false
    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (activity.type === `${AS2_NS}Announce` &&
          activity.object?.first?.id === noteId) {
        foundInOutbox = true
        break
      }
    }
    assert.ok(foundInOutbox)
  })

  it('does not announce the object of a remote public Create in onPublic', async () => {
    const authorUsername = 'botlitepubrelayclientremoteauthor1'
    const authorId = nockFormat({ username: authorUsername, domain: REMOTE_HOST })
    const noteId = nockFormat({
      username: authorUsername,
      type: 'note',
      num: 1,
      domain: REMOTE_HOST
    })
    const createId = nockFormat({
      username: authorUsername,
      type: 'create',
      num: 1,
      domain: REMOTE_HOST
    })
    const create = await as2.import({
      type: 'Create',
      id: createId,
      actor: authorId,
      to: 'as:Public',
      object: {
        type: 'Note',
        id: noteId,
        attributedTo: authorId,
        content: 'remote content should not be forwarded',
        to: 'as:Public'
      }
    })
    await bot.onPublic(create)
    await context.onIdle()

    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (activity.type === `${AS2_NS}Announce` &&
          activity.object?.first?.id === noteId) {
        assert.fail('should not have announced a remote Create object')
      }
    }
  })

  it('does not announce a non-Create public activity in onPublic', async () => {
    const authorUsername = 'botlitepubrelayclientauthor2'
    const authorId = formatter.format({ username: authorUsername })
    const noteId = formatter.format({
      username: authorUsername,
      type: 'note',
      nanoid: 'localnote2'
    })
    const likeId = formatter.format({
      username: authorUsername,
      type: 'like',
      nanoid: 'locallike1'
    })
    const like = await as2.import({
      type: 'Like',
      id: likeId,
      actor: authorId,
      object: noteId,
      to: 'as:Public'
    })
    await bot.onPublic(like)
    await context.onIdle()

    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (activity.type === `${AS2_NS}Announce` &&
          activity.object?.first?.id === noteId) {
        assert.fail('should not have announced a Like target')
      }
    }
  })

  it('does not announce a public Create when relayForwarding is false', async () => {
    const relayForwarding = false
    bot = new LitePubRelayClientBot(botName, { relay, relayForwarding })
    assert.ok(bot)
    bots[botName] = bot
    await bot.initialize(context)
    await context.onIdle()

    const authorUsername = 'botlitepubrelayclientauthor3'
    const authorId = formatter.format({ username: authorUsername })
    const noteId = formatter.format({
      username: authorUsername,
      type: 'note',
      nanoid: 'localnote3'
    })
    const createId = formatter.format({
      username: authorUsername,
      type: 'create',
      nanoid: 'localcreate3'
    })
    const create = await as2.import({
      type: 'Create',
      id: createId,
      actor: authorId,
      to: 'as:Public',
      object: {
        type: 'Note',
        id: noteId,
        attributedTo: authorId,
        content: 'should not be forwarded when relayForwarding is false',
        to: 'as:Public'
      }
    })
    await bot.onPublic(create)
    await context.onIdle()

    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (activity.type === `${AS2_NS}Announce` &&
          activity.object?.first?.id === noteId) {
        assert.fail('should not have announced when relayForwarding is false')
      }
    }
  })

  it('subscribes to multiple relays when relay is an array', async () => {
    const multiA = nockFormat({ username: 'botlitepubmultia', domain: REMOTE_HOST })
    const multiB = nockFormat({ username: 'botlitepubmultib', domain: REMOTE_HOST })
    bot = new LitePubRelayClientBot(botName, { relay: [multiA, multiB] })
    bots[botName] = bot
    await bot.initialize(context)
    await context.onIdle()

    let foundA = false
    let foundB = false
    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (isRelayFollow(activity, multiA)) foundA = true
      if (isRelayFollow(activity, multiB)) foundB = true
    }
    assert.ok(foundA, 'should have followed relay A')
    assert.ok(foundB, 'should have followed relay B')
  })

  it('unfollows relays no longer in the relay config on initialize', async () => {
    const persistRelay = nockFormat({ username: 'botlitepubpersist', domain: REMOTE_HOST })
    const removedRelay = nockFormat({ username: 'botlitepubremoved', domain: REMOTE_HOST })

    bot = new LitePubRelayClientBot(botName, { relay: [persistRelay, removedRelay] })
    bots[botName] = bot
    await bot.initialize(context)
    await context.onIdle()

    const persistActor = await context.getObject(persistRelay)
    const removedActor = await context.getObject(removedRelay)
    await actorStorage.addToCollection(botName, 'following', persistActor)
    await actorStorage.addToCollection(botName, 'following', removedActor)

    bot = new LitePubRelayClientBot(botName, { relay: [persistRelay] })
    bots[botName] = bot
    await bot.initialize(context)
    await context.onIdle()

    let foundRemovedUndo = false
    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (isRelayUnfollow(activity, removedRelay)) {
        foundRemovedUndo = true
        break
      }
    }
    assert.ok(foundRemovedUndo, 'should have sent Undo Follow for removed relay')
    assert.strictEqual(
      await actorStorage.isInCollection(botName, 'following', removedActor),
      false,
      'removed relay should no longer be in following'
    )
    assert.strictEqual(
      await actorStorage.isInCollection(botName, 'following', persistActor),
      true,
      'persistent relay should still be in following'
    )
  })

  it('is idempotent when re-initialized with same relay config', async () => {
    const stableRelay = nockFormat({ username: 'botlitepubstable', domain: REMOTE_HOST })
    bot = new LitePubRelayClientBot(botName, { relay: stableRelay })
    bots[botName] = bot
    await bot.initialize(context)
    await context.onIdle()

    let firstCount = 0
    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (isRelayFollow(activity, stableRelay)) firstCount++
    }

    await bot.initialize(context)
    await context.onIdle()

    let secondCount = 0
    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (isRelayFollow(activity, stableRelay)) secondCount++
    }
    assert.strictEqual(secondCount, firstCount, 're-initialize should not produce a new Follow')
  })

  it('announces on onPublic when at least one relay is a follower', async () => {
    const followerRelay = nockFormat({ username: 'botlitepubfollower', domain: REMOTE_HOST })
    bot = new LitePubRelayClientBot(botName, { relay: followerRelay })
    bots[botName] = bot
    await bot.initialize(context)
    await context.onIdle()

    const relayActor = await context.getObject(followerRelay)
    await actorStorage.addToCollection(botName, 'followers', relayActor)

    const authorUsername = 'botlitepubfollowerauthor'
    const authorId = formatter.format({ username: authorUsername })
    const noteId = formatter.format({
      username: authorUsername,
      type: 'note',
      nanoid: 'followernote1'
    })
    const createId = formatter.format({
      username: authorUsername,
      type: 'create',
      nanoid: 'followercreate1'
    })
    const create = await as2.import({
      type: 'Create',
      id: createId,
      actor: authorId,
      to: 'as:Public',
      object: {
        type: 'Note',
        id: noteId,
        attributedTo: authorId,
        content: 'hello followers',
        to: 'as:Public'
      }
    })
    await bot.onPublic(create)
    await context.onIdle()

    let foundInOutbox = false
    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (activity.type === `${AS2_NS}Announce` &&
          activity.object?.first?.id === noteId) {
        foundInOutbox = true
        break
      }
    }
    assert.ok(foundInOutbox)
  })

  it('does not announce on onPublic when relay is in following but not in followers', async () => {
    const followOnlyRelay = nockFormat({ username: 'botlitepubfollowonly', domain: REMOTE_HOST })
    bot = new LitePubRelayClientBot(botName, { relay: followOnlyRelay })
    bots[botName] = bot
    await bot.initialize(context)
    await context.onIdle()

    const relayActor = await context.getObject(followOnlyRelay)
    await actorStorage.addToCollection(botName, 'following', relayActor)

    const authorUsername = 'botlitepubfollowonlyauthor'
    const authorId = formatter.format({ username: authorUsername })
    const noteId = formatter.format({
      username: authorUsername,
      type: 'note',
      nanoid: 'followonlynote1'
    })
    const createId = formatter.format({
      username: authorUsername,
      type: 'create',
      nanoid: 'followonlycreate1'
    })
    const create = await as2.import({
      type: 'Create',
      id: createId,
      actor: authorId,
      to: 'as:Public',
      object: {
        type: 'Note',
        id: noteId,
        attributedTo: authorId,
        content: 'should not announce',
        to: 'as:Public'
      }
    })
    await bot.onPublic(create)
    await context.onIdle()

    for await (const item of actorStorage.items(botName, 'outbox')) {
      const activity = await objectStorage.read(item.id)
      if (activity.type === `${AS2_NS}Announce` &&
          activity.object?.first?.id === noteId) {
        assert.fail('should not have announced when relay is not in followers')
      }
    }
  })

  it('fans out to other bots onPublic when an Announce arrives from the subscribed relay', async () => {
    const fanoutBotName = 'botlitepubrelayclientfanout'
    const fanoutRelayUsername = 'botlitepubrelayclientfanoutrelay'
    const fanoutRelay = nockFormat({
      username: fanoutRelayUsername,
      domain: REMOTE_HOST
    })
    TEST_USERNAMES.push(fanoutBotName)

    const fanoutBot = new LitePubRelayClientBot(fanoutBotName, {
      relay: fanoutRelay
    })
    bots[fanoutBotName] = fanoutBot

    const fanoutContext = new BotContext(
      fanoutBotName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger,
      bots
    )

    await fanoutBot.initialize(fanoutContext)
    await fanoutContext.onIdle()

    const inbox = nockFormat({
      username: fanoutRelayUsername,
      collection: 'inbox',
      domain: REMOTE_HOST
    })
    const body = getBody(inbox)
    assert.ok(body, 'expected a Follow to have been posted to the relay')
    const follow = JSON.parse(body)
    const accept = await as2.import({
      type: 'Accept',
      id: nockFormat({
        username: fanoutRelayUsername,
        type: 'Accept',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: fanoutRelay,
      to: formatter.format({ username: fanoutBotName }),
      object: {
        id: follow.id,
        type: follow.type,
        object: follow.object
      }
    })
    await handler.handleActivity(fanoutBot, accept)

    const calls = []
    const spyBotName = 'botlitepubrelayclientfanoutspy'
    bots[spyBotName] = {
      id: formatter.format({ username: spyBotName }),
      username: spyBotName,
      onPublic: async (activity) => {
        calls.push(activity)
      }
    }

    const announce = await as2.import({
      type: 'Announce',
      id: nockFormat({
        username: fanoutRelayUsername,
        type: 'Announce',
        num: 1,
        domain: REMOTE_HOST
      }),
      actor: fanoutRelay,
      object: `https://${REMOTE_HOST}/user/otherperson/statuses/1`,
      to: `${fanoutRelay}/followers`
    })
    await fanoutBot.handleActivity(announce)

    assert.strictEqual(
      calls.length,
      1,
      'spy bot onPublic should have been called exactly once'
    )
    const receivedId = calls[0].id?.first?.id ?? calls[0].id
    const expectedId = announce.id?.first?.id ?? announce.id
    assert.strictEqual(receivedId, expectedId)
  })
})
