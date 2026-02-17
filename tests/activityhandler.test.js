import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { ActivityHandler } from '../lib/activityhandler.js'
import { BotDataStorage } from '../lib/botdatastorage.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { Authorizer } from '../lib/authorizer.js'
import { ObjectCache } from '../lib/objectcache.js'
import as2 from '../lib/activitystreams.js'
import Logger from 'pino'
import { nockSetup, postInbox, makeActor as makeNockActor, nockFormat as rawNockFormat } from '@evanp/activitypub-nock'
import { Digester } from '../lib/digester.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { BotContext } from '../lib/botcontext.js'
import { Transformer } from '../lib/microsyntax.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'
import OKBot from '../lib/bots/ok.js'
import EventLoggingBot from './fixtures/eventloggingbot.js'

describe('ActivityHandler', () => {
  const domain = 'activityhandler.local.test'
  const socialDomain = 'activityhandler-social.test'
  const thirdDomain = 'activityhandler-third.test'
  const origin = `https://${domain}`
  const botName = 'activityhandlertestok'
  const loggerBotName = 'activityhandlertestlogging'
  const calculonName = 'activityhandlertestcalculon'
  const localObjectUser = 'activityhandlertest1'
  const testUsernames = [botName, loggerBotName, calculonName, localObjectUser]

  function makeActor (username, domain = socialDomain) {
    return makeNockActor(username, domain)
  }

  function nockFormat (params) {
    return rawNockFormat(params.domain ? params : { domain: socialDomain, ...params })
  }

  let connection = null
  let botDataStorage = null
  let objectStorage = null
  let keyStorage = null
  let actorStorage = null
  let formatter = null
  let client = null
  let distributor = null
  let authz = null
  let cache = null
  let handler = null
  let logger = null
  let botId = null
  let bot = null
  let lb = null
  let lbId = null
  let transformer = null
  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter(origin)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: domain,
      remoteDomains: [socialDomain, thirdDomain]
    })
    botDataStorage = new BotDataStorage(connection)
    objectStorage = new ObjectStorage(connection)
    keyStorage = new KeyStorage(connection, logger)
    actorStorage = new ActorStorage(connection, formatter)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger)
    authz = new Authorizer(actorStorage, formatter, client)
    cache = new ObjectCache({ longTTL: 3600 * 1000, shortTTL: 300 * 1000, maxItems: 1000 })
    transformer = new Transformer(`${origin}/tag/`, client)
    bot = new OKBot(botName)
    lb = new EventLoggingBot(loggerBotName)
    await bot.initialize(
      new BotContext(
        bot.username,
        botDataStorage,
        objectStorage,
        actorStorage,
        client,
        distributor,
        formatter,
        transformer,
        logger
      )
    )
    await lb.initialize(
      new BotContext(
        lb.username,
        botDataStorage,
        objectStorage,
        actorStorage,
        client,
        distributor,
        formatter,
        transformer,
        logger
      )
    )
    botId = formatter.format({ username: botName })
    lbId = formatter.format({ username: loggerBotName })
    await objectStorage.create(await as2.import({
      id: formatter.format({ username: localObjectUser, type: 'object', nanoid: '_pEWsKke-7lACTdM3J_qd' }),
      type: 'Object',
      attributedTo: formatter.format({ username: localObjectUser }),
      to: 'as:Public'
    }))
    nockSetup(socialDomain)
    nockSetup(thirdDomain)
  })
  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: domain,
      remoteDomains: [socialDomain, thirdDomain]
    })
    await connection.close()
    handler = null
    cache = null
    authz = null
    distributor = null
    client = null
    formatter = null
    actorStorage = null
    keyStorage = null
    botDataStorage = null
    objectStorage = null
    connection = null
  })
  beforeEach(async () => {
    Object.assign(postInbox, {})
  })
  it('can initialize', async () => {
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
    assert.ok(handler)
  })
  it('can handle a create activity', async () => {
    const activity = await as2.import({
      type: 'Create',
      actor: nockFormat({ username: 'remote1' }),
      id: nockFormat({ username: 'remote1', type: 'create', num: 1 }),
      object: {
        id: 'https://activityhandler-social.test/user/remote1/note/1',
        type: 'Note',
        content: 'Hello, world!',
        to: 'as:Public'
      },
      to: 'as:Public'
    })
    await handler.handleActivity(bot, activity)
    const cached = await cache.get(activity.object?.first.id)
    assert.equal(cached.content, 'Hello, world!')
  })
  it('can handle a create activity with a reply', async () => {
    const oid = formatter.format({
      username: botName,
      type: 'note',
      nanoid: 'k5MtHI1aGle4RocLqnw7x'
    })
    const original = await as2.import({
      id: oid,
      type: 'Note',
      attributedTo: formatter.format({ username: botName }),
      to: 'as:Public',
      content: 'Original note'
    })
    await objectStorage.create(original)
    const activity = await as2.import({
      type: 'Create',
      actor: 'https://activityhandler-social.test/user/remote1',
      id: 'https://activityhandler-social.test/user/remote1/object/3',
      object: {
        inReplyTo: oid,
        id: 'https://activityhandler-social.test/user/remote1/object/4',
        type: 'Note',
        content: 'Reply note',
        to: 'as:Public'
      },
      to: 'as:Public'
    })
    const collection = await objectStorage.getCollection(oid, 'replies')
    assert.equal(collection.totalItems, 0)
    await handler.handleActivity(bot, activity)
    const collection2 = await objectStorage.getCollection(oid, 'replies')
    assert.equal(collection2.totalItems, 1)
    await handler.onIdle()
    assert.equal(postInbox.remote1, 1)
    assert.ok(true)
  })
  it('can handle an update activity', async () => {
    const activity = await as2.import({
      type: 'Update',
      actor: 'https://activityhandler-social.test/user/remote1',
      id: 'https://activityhandler-social.test/user/remote1/update/1',
      object: {
        id: 'https://activityhandler-social.test/user/remote1/note/1',
        type: 'Note',
        content: 'Hello, world! (updated)',
        to: 'as:Public'
      },
      to: 'as:Public'
    })
    await handler.handleActivity(bot, activity)
    const cached = await cache.get(activity.object?.first.id)
    assert.equal(cached.content, 'Hello, world! (updated)')
  })
  it('can handle a delete activity', async () => {
    const activity = await as2.import({
      type: 'Delete',
      actor: 'https://activityhandler-social.test/user/remote1',
      id: 'https://activityhandler-social.test/user/remote1/delete/1',
      object: 'https://activityhandler-social.test/user/remote1/note/1',
      to: 'as:Public'
    })
    await handler.handleActivity(bot, activity)
    const cached = await cache.get(activity.object?.first.id)
    assert.equal(cached, undefined)
  })
  it('can handle an add activity', async () => {
    const activity = await as2.import({
      type: 'Add',
      actor: 'https://activityhandler-social.test/user/remote1',
      id: 'https://activityhandler-social.test/user/remote1/add/1',
      object: {
        id: 'https://activityhandler-social.test/user/remote1/note/1',
        type: 'Note',
        attributedTo: 'https://activityhandler-social.test/user/remote1',
        to: 'as:Public'
      },
      target: {
        id: 'https://activityhandler-social.test/user/remote1/collection/1',
        type: 'Collection',
        attributedTo: 'https://activityhandler-social.test/user/remote1',
        to: 'as:Public'
      },
      to: 'as:Public'
    })
    await handler.handleActivity(bot, activity)
    const cached = await cache.get(activity.object?.first.id)
    assert.equal(cached.id, activity.object?.first.id)
    const cached2 = await cache.get(activity.target?.first.id)
    assert.equal(cached2.id, activity.target?.first.id)
    assert.equal(
      true,
      await cache.isMember(activity.target?.first, activity.object?.first)
    )
  })

  it('can handle a remove activity', async () => {
    const activity = await as2.import({
      type: 'Remove',
      actor: 'https://activityhandler-social.test/user/remote1',
      id: 'https://activityhandler-social.test/user/remote1/remove/1',
      object: {
        id: 'https://activityhandler-social.test/user/remote1/note/1',
        type: 'Note',
        attributedTo: 'https://activityhandler-social.test/user/remote1',
        to: 'as:Public'
      },
      target: {
        id: 'https://activityhandler-social.test/user/remote1/collection/1',
        type: 'Collection',
        attributedTo: 'https://activityhandler-social.test/user/remote1',
        to: 'as:Public'
      },
      to: 'as:Public'
    })
    await handler.handleActivity(bot, activity)
    const cached = await cache.get(activity.object?.first.id)
    assert.equal(cached.id, activity.object?.first.id)
    const cached2 = await cache.get(activity.target?.first.id)
    assert.equal(cached2.id, activity.target?.first.id)
    assert.equal(
      false,
      await cache.isMember(activity.target?.first, activity.object?.first)
    )
  })
  it('can handle a follow activity', async () => {
    const actor = await makeActor('follower1')
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor))
    const activity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler-social.test/user/follower1/follow/1',
      actor: actor.id,
      object: botId,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      true,
      await actorStorage.isInCollection(botName, 'followers', actor))
    await handler.onIdle()
    // accept and add
    assert.equal(postInbox.follower1, 2)
  })
  it('can handle a duplicate follow activity', async () => {
    const actor = await makeActor('follower2')
    await actorStorage.addToCollection(botName, 'followers', actor)
    const activity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler-social.test/user/follower2/follow/2',
      actor: actor.id,
      object: botId,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      true,
      await actorStorage.isInCollection(botName, 'followers', actor))
    await handler.onIdle()
    assert.ok(!postInbox.follower2)
  })
  it('can handle a follow from a blocked account', async () => {
    const actor = await makeActor('follower3')
    await actorStorage.addToCollection(botName, 'blocked', actor)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'blocked', actor)
    )
    const activity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler-social.test/user/follower3/follow/1',
      actor: actor.id,
      object: botId,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor))
    await handler.onIdle()
    assert.ok(!postInbox.follower3)
  })
  it('notifies the bot of a follow activity', async () => {
    const actor = await makeActor('follower4')
    const activity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler-social.test/user/follower4/follow/1',
      actor: actor.id,
      object: lbId,
      to: lbId
    })
    await handler.handleActivity(lb, activity)
    assert.ok(lb.follows.has(activity.id))
    await handler.onIdle()
  })
  it('can handle an accept activity', async () => {
    const actor = await makeActor('accepter1')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestok/follow/1',
      actor: botId,
      object: actor.id,
      to: actor.id
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection(botName, 'pendingFollowing', followActivity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
    const activity = await as2.import({
      type: 'Accept',
      id: 'https://activityhandler-social.test/user/remote1/accept/1',
      actor: actor.id,
      object: followActivity.id,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      true,
      await actorStorage.isInCollection(botName, 'following', actor))
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'pendingFollowing', followActivity))
  })
  it('can ignore an accept activity for a non-existing follow', async () => {
    const actor = await makeActor('accepter2')
    const activity = await as2.import({
      type: 'Accept',
      id: 'https://activityhandler-social.test/user/accepter2/accept/1',
      actor: actor.id,
      object: 'https://activityhandler.local.test/user/activityhandlertestok/follow/69',
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
  })
  it('can ignore an accept activity from a blocked account', async () => {
    const actor = await makeActor('accepter3')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestok/follow/3',
      actor: botId,
      object: actor.id,
      to: actor.id
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection(botName, 'pendingFollowing', followActivity)
    await actorStorage.addToCollection(botName, 'blocked', actor)
    const activity = await as2.import({
      type: 'Accept',
      id: 'https://activityhandler-social.test/user/accepter3/accept/1',
      actor: actor.id,
      object: followActivity.id,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
  })

  it('can ignore an accept activity for a remote follow activity', async () => {
    const actor = await makeActor('accepter4')
    const activity = await as2.import({
      type: 'Accept',
      id: 'https://activityhandler-social.test/user/accepter3/accept/1',
      actor: actor.id,
      object: {
        type: 'Follow',
        id: 'https://activityhandler-third.test/user/other/follow/3',
        actor: 'https://activityhandler-third.test/user/other',
        object: actor.id,
        to: [actor.id, 'as:Public']
      },
      to: ['https://activityhandler-third.test/user/other', 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
  })
  it('can ignore an accept activity for a follow of a different actor', async () => {
    const actor5 = await makeActor('accepter5')
    const actor6 = await makeActor('accepter6')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestok/follow/6',
      actor: botId,
      object: actor6.id,
      to: [actor6.id, 'as:Public']
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection(botName, 'pendingFollowing', followActivity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor5))
    const activity = await as2.import({
      type: 'Accept',
      id: 'https://activityhandler-social.test/user/remote1/accept/1',
      actor: actor5.id,
      object: followActivity.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor5))
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor6))
    assert.equal(
      true,
      await actorStorage.isInCollection(botName, 'pendingFollowing', followActivity))
  })
  it('can ignore an accept activity for a follow by a different actor', async () => {
    const actor7 = await makeActor('accepter7')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestcalculon/follow/7',
      actor: 'https://activityhandler.local.test/user/activityhandlertestcalculon',
      object: actor7.id,
      to: [actor7.id, 'as:Public']
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection('activityhandlertestcalculon', 'pendingFollowing', followActivity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor7))
    const activity = await as2.import({
      type: 'Accept',
      id: 'https://activityhandler-social.test/user/accepter7/accept/7',
      actor: actor7.id,
      object: followActivity.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor7))
    assert.equal(
      false,
      await actorStorage.isInCollection('activityhandlertestcalculon', 'following', actor7))
    assert.equal(
      true,
      await actorStorage.isInCollection('activityhandlertestcalculon', 'pendingFollowing', followActivity))
  })
  it('can handle an reject activity', async () => {
    const actor = await makeActor('rejecter1')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestok/follow/101',
      actor: botId,
      object: actor.id,
      to: actor.id
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection(botName, 'pendingFollowing', followActivity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
    const activity = await as2.import({
      type: 'Reject',
      id: 'https://activityhandler-social.test/user/rejecter1/reject/1',
      actor: actor.id,
      object: followActivity.id,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'pendingFollowing', followActivity))
  })
  it('can ignore an reject activity for a non-existing follow', async () => {
    const actor = await makeActor('rejecter2')
    const activity = await as2.import({
      type: 'Reject',
      id: 'https://activityhandler-social.test/user/rejecter2/reject/1',
      actor: actor.id,
      object: 'https://activityhandler.local.test/user/activityhandlertestok/follow/69',
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
  })
  it('can ignore an reject activity from a blocked account', async () => {
    const actor = await makeActor('rejecter3')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestok/follow/103',
      actor: botId,
      object: actor.id,
      to: actor.id
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection(botName, 'pendingFollowing', followActivity)
    await actorStorage.addToCollection(botName, 'blocked', actor)
    const activity = await as2.import({
      type: 'Reject',
      id: 'https://activityhandler-social.test/user/rejecter3/reject/1',
      actor: actor.id,
      object: followActivity.id,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
  })

  it('can ignore an reject activity for a remote follow activity', async () => {
    const actor = await makeActor('rejecter4')
    const activity = await as2.import({
      type: 'Reject',
      id: 'https://activityhandler-social.test/user/rejecter4/reject/1',
      actor: actor.id,
      object: {
        type: 'Follow',
        id: 'https://activityhandler-third.test/user/other/follow/103',
        actor: 'https://activityhandler-third.test/user/other',
        object: actor.id,
        to: [actor.id, 'as:Public']
      },
      to: ['https://activityhandler-third.test/user/other', 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
  })
  it('can ignore an reject activity for a follow of a different actor', async () => {
    const actor5 = await makeActor('rejecter5')
    const actor6 = await makeActor('rejecter6')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestok/follow/106',
      actor: botId,
      object: actor6.id,
      to: [actor6.id, 'as:Public']
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection(botName, 'pendingFollowing', followActivity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor5))
    const activity = await as2.import({
      type: 'Reject',
      id: 'https://activityhandler-social.test/user/rejecter5/reject/1',
      actor: actor5.id,
      object: followActivity.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor5))
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor6))
    assert.equal(
      true,
      await actorStorage.isInCollection(botName, 'pendingFollowing', followActivity))
  })
  it('can ignore an reject activity for a follow by a different actor', async () => {
    const actor7 = await makeActor('rejecter7')
    const followActivity = await as2.import({
      type: 'Follow',
      id: 'https://activityhandler.local.test/user/activityhandlertestcalculon/follow/107',
      actor: 'https://activityhandler.local.test/user/activityhandlertestcalculon',
      object: actor7.id,
      to: [actor7.id, 'as:Public']
    })
    await objectStorage.create(followActivity)
    await actorStorage.addToCollection('activityhandlertestcalculon', 'pendingFollowing', followActivity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor7))
    const activity = await as2.import({
      type: 'Reject',
      id: 'https://activityhandler-social.test/user/rejecter7/reject/7',
      actor: actor7.id,
      object: followActivity.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor7))
    assert.equal(
      false,
      await actorStorage.isInCollection('activityhandlertestcalculon', 'following', actor7))
    assert.equal(
      true,
      await actorStorage.isInCollection('activityhandlertestcalculon', 'pendingFollowing', followActivity))
  })
  it('can handle a like activity', async () => {
    const actor = await makeActor('liker1')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: '_SivlqjrNpdV3KOJ6cC3L'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker1/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', activity)
    )
    await handler.onIdle()
    assert.equal(postInbox.liker1, 1)
  })
  it('can ignore a like activity for a remote object', async () => {
    const actor = await makeActor('liker2')
    const objectId = 'https://activityhandler-third.test/user/other/note/1'
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker2/like/1',
      object: objectId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(objectId, 'likes', activity)
    )
  })
  it('can ignore a like activity for a non-existing object', async () => {
    const actor = await makeActor('liker3')
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker3/like/1',
      object: 'https://activityhandler.local.test/user/activityhandlertestok/note/doesnotexist',
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(activity.object?.first.id, 'likes', activity)
    )
  })
  it('can ignore a like activity from a blocked account', async () => {
    const actor = await makeActor('liker4')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'wpOmBSs04osbTtYoR9C8p'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    await actorStorage.addToCollection(botName, 'blocked', actor)
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker4/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(note.id, 'likes', activity)
    )
  })
  it('can ignore a like activity for an unreadable object', async () => {
    const actor = await makeActor('liker5')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: '9FZgbPv3G6MYKGPir0eI6'
      }),
      type: 'Note',
      content: 'Private note @other',
      to: [formatter.format({ username: 'other' })],
      tags: [{ type: 'Mention', href: formatter.format({ username: 'other' }) }]
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker4/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', activity)
    )
  })
  it('can ignore a like activity for an object by a different actor', async () => {
    const actor = await makeActor('liker6')
    const note = await as2.import({
      attributedTo: formatter.format({ username: 'other' }),
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'p8YbioA43kgZR41N3-tb2'
      }),
      type: 'Note',
      content: 'Public note',
      to: ['as:Public']
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker6/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', activity)
    )
  })
  it('can ignore a duplicate like activity', async () => {
    const actor = await makeActor('liker7')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'TyCJRI4aMmW2KWtDZSCVM'
      }),
      type: 'Note',
      content: 'Public note',
      to: ['as:Public']
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker7/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', activity)
    )
  })
  it('can ignore a like activity by an actor that has liked before', async () => {
    const actor = await makeActor('liker8')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: '49s-F59oxQ6dX4SFiCqNg'
      }),
      type: 'Note',
      content: 'Public note',
      to: [formatter.format({ username: 'other' })]
    })
    await objectStorage.create(note)
    const activity1 = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker8/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    const activity2 = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/liker8/like/2',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity1)
    await handler.handleActivity(bot, activity2)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', activity2)
    )
  })
  it('notifies the bot of a like activity', async () => {
    const actor = await makeActor('liker9')
    const note = await as2.import({
      attributedTo: lbId,
      id: formatter.format({
        username: loggerBotName,
        type: 'note',
        nanoid: 'IGeAucyHD-s3Ywg9X9sCo'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: nockFormat({
        username: 'liker9',
        type: 'Like',
        nanoid: '3fKK6LcMtqrAp1Ekn471u'
      }),
      object: note.id,
      to: [lbId, 'as:Public']
    })
    await handler.handleActivity(lb, activity)
    assert.ok(lb.likes.has(activity.id))
  })
  it('can handle an announce activity', async () => {
    const actor = await makeActor('announcer1')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'odQN6GR4v71ZxN1wsstvl'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer1/announce/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', activity)
    )
    await handler.onIdle()
    assert.equal(postInbox.announcer1, 1)
  })
  it('can ignore an announce activity for a remote object', async () => {
    const actor = await makeActor('announcer2')
    const objectId = 'https://activityhandler-third.test/user/other/note/1'
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer2/announce/1',
      object: objectId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(objectId, 'shares', activity)
    )
  })
  it('can ignore an announce activity for a non-existing object', async () => {
    const actor = await makeActor('announcer3')
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer3/announce/1',
      object: 'https://activityhandler.local.test/user/activityhandlertestok/note/doesnotexist',
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(activity.object?.first.id, 'shares', activity)
    )
  })
  it('can ignore an announce activity from a blocked account', async () => {
    const actor = await makeActor('announcer4')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'GMvbLj8rKzbtx1kvjCGUm'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    await actorStorage.addToCollection(botName, 'blocked', actor)
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer4/announce/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(note.id, 'shares', activity)
    )
  })
  it('can ignore an announce activity for an unreadable object', async () => {
    const actor = await makeActor('announcer5')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'yWyHTZH9VtAA1ViEl7sil'
      }),
      type: 'Note',
      content: 'Private note @other',
      to: [formatter.format({ username: 'other' })],
      tags: [{ type: 'Mention', href: formatter.format({ username: 'other' }) }]
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer4/announce/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'shares', activity)
    )
  })
  it('can ignore an announce activity for an object by a different actor', async () => {
    const actor = await makeActor('announcer6')
    const note = await as2.import({
      attributedTo: formatter.format({ username: 'other' }),
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'CoI4vcLRjG7f9Sj9yK-6g'
      }),
      type: 'Note',
      content: 'Public note',
      to: ['as:Public']
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer6/announce/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'shares', activity)
    )
  })
  it('can ignore a duplicate announce activity', async () => {
    const actor = await makeActor('announcer7')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'ndzHHtejBL83v3iiqsl4L'
      }),
      type: 'Note',
      content: 'Public note',
      to: ['as:Public']
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer7/announce/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', activity)
    )
  })
  it('can ignore an announce activity by an actor that has shared before', async () => {
    const actor = await makeActor('announcer8')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: '7AAsKT9oKqM3PnXELNYB7'
      }),
      type: 'Note',
      content: 'Public note',
      to: [formatter.format({ username: 'other' })]
    })
    await objectStorage.create(note)
    const activity1 = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer8/announce/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    const activity2 = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/announcer8/announce/2',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity1)
    await handler.handleActivity(bot, activity2)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'shares', activity2)
    )
  })
  it('notifies the bot on an announce activity', async () => {
    const actor = await makeActor('announcer9')
    const note = await as2.import({
      attributedTo: lbId,
      id: formatter.format({
        username: loggerBotName,
        type: 'note',
        nanoid: 'LNCVgovrjpA6oSKnGDax2'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: nockFormat({
        username: 'announcer9',
        type: 'Announce',
        nanoid: 'LmVvlEBHNf2X6nfgzMe6F'
      }),
      object: note.id,
      to: [lbId, 'as:Public']
    })
    await handler.handleActivity(lb, activity)
    assert.ok(lb.shares.has(activity.id))
  })
  it('can handle a block activity', async () => {
    const actor = await makeActor('blocker1')
    await actorStorage.addToCollection(botName, 'followers', actor)
    await actorStorage.addToCollection(botName, 'following', actor)
    const activity = await as2.import({
      type: 'Block',
      id: 'https://activityhandler-social.test/user/blocker1/block/1',
      actor: actor.id,
      object: botId,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor))
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'following', actor))
  })
  it('can handle a block activity for a pending user', async () => {
    const actor = await makeActor('blocker2')
    await actorStorage.addToCollection(botName, 'pendingFollowing', actor)
    const activity = await as2.import({
      type: 'Block',
      id: 'https://activityhandler-social.test/user/blocker2/block/1',
      actor: actor.id,
      object: botId,
      to: botId
    })
    await handler.handleActivity(bot, activity)
    assert.equal(
      false,
      await actorStorage.isInCollection(botName, 'pendingFollowing', actor))
  })
  it('can handle a flag activity for an actor', async () => {
    const actor = await makeActor('flagger1')
    const activity = await as2.import({
      type: 'Flag',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/flagger1/flag/1',
      object: botId,
      to: [botId, formatter.format({ server: true })]
    })
    await handler.handleActivity(bot, activity)
  })
  it('can handle a flag activity for an object', async () => {
    const actor = await makeActor('flagger2')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'h3q3QZy2BzYwX7a4vJ5v3'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Flag',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/flagger2/flag/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
  })
  it('can handle an undo for an unrecognized activity type', async () => {
    const actor = await makeActor('undoer1')
    const activity = await as2.import({
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        {
          ex: 'https://example.com/ns/',
          Foo: {
            '@id': 'ex:Foo',
            '@type': '@id'
          }
        }
      ],
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer1/undo/1',
      object: {
        type: 'Foo',
        id: 'https://activityhandler-social.test/user/undoer1/foo/1'
      },
      to: botId
    })
    await handler.handleActivity(bot, activity)
  })
  it('can handle an undo for a like activity', async () => {
    const actor = await makeActor('undoer2')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'aQ8TL9jHhudjiQSqE8tYN'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer2/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', activity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer2/undo/1',
      object: {
        type: 'Like',
        id: activity.id,
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', activity)
    )
  })
  it('can ignore an undo for a like activity with a different actor', async () => {
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'elgLDhn0kty204Tk8rcMD'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const liker = await makeActor('liker9', 'activityhandler-third.test')
    const likeActivity = await as2.import({
      type: 'Like',
      actor: liker.id,
      id: nockFormat({ domain: 'activityhandler-third.test', username: 'liker9', type: 'like', num: 1, obj: note.id }),
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, likeActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
    const undoer = await makeActor('undoer3', 'activityhandler-social.test')
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: undoer.id,
      id: nockFormat({ domain: 'activityhandler-social.test', username: 'undoer3', type: 'undo', num: 1, obj: likeActivity.id }),
      object: {
        type: 'Like',
        id: likeActivity.id
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
  })
  it('can ignore an undo for a like activity of a remote object', async () => {
    const actor = await makeActor('undoer4')
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer4/undo/1',
      object: {
        type: 'Like',
        id: 'https://activityhandler-social.test/user/undoer4/like/1',
        actor: 'https://activityhandler-social.test/user/undoer4',
        object: 'https://activityhandler-third.test/user/other/note/1',
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a like activity of a non-existent object', async () => {
    const actor = await makeActor('undoer5')
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer5/undo/1',
      object: {
        type: 'Like',
        id: 'https://activityhandler-social.test/user/undoer5/like/1',
        actor: actor.id,
        object: 'https://activityhandler.local.test/user/activityhandlertestok/note/doesnotexist',
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a like activity of an unreadable object', async () => {
    const actor = await makeActor('undoer6')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'C-pFLhIGnM1XlpmXgNlfW'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: formatter.format({ username: 'other', collection: 'followers' })
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer6/undo/1',
      object: {
        type: 'Like',
        id: 'https://activityhandler-social.test/user/undoer6/like/1',
        actor: actor.id,
        object: note.id,
        to: [botId]
      },
      to: [botId]
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a like activity of a blocked actor', async () => {
    const actor = await makeActor('undoer7')
    await actorStorage.addToCollection(botName, 'blocked', actor)
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'rV_iftsHDMdAQBqfgg8DD'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer7/undo/1',
      object: {
        type: 'Like',
        id: 'https://activityhandler-social.test/user/undoer7/like/1',
        actor: actor.id,
        object: note.id,
        to: [botId]
      },
      to: [botId]
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a like activity that has already been undone', async () => {
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'KxQLHLAENW_CpMycvcpx4'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const actor = await makeActor('undoer8')
    const likeActivity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer8/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, likeActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer8/undo/1',
      object: {
        type: 'Like',
        id: 'https://activityhandler-social.test/user/undoer8/like/1',
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
    const duplicateActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer8/undo/2',
      object: {
        type: 'Like',
        id: 'https://activityhandler-social.test/user/undoer8/like/1',
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, duplicateActivity)
    assert.ok(true)
  })
  it('can handle an undo for a like activity followed by another like', async () => {
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'LE2yKAebFSmMqSjN6naLl'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const actor = await makeActor('undoer9')
    const likeActivity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer9/like/1',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, likeActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer9/undo/1',
      object: {
        type: 'Like',
        id: 'https://activityhandler-social.test/user/undoer9/like/1',
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
    const reLikeActivity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer9/like/2',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, reLikeActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', reLikeActivity)
    )
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
  })
  it('can handle an undo for a like activity by id', async () => {
    const actor = await makeActor('undoer10')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'nhzIHLcnHgU2l0lMb7dRl'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const likeActivity = await as2.import({
      type: 'Like',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer10/like/1/activityhandler.local.test/user/activityhandlertestok/note/nhzIHLcnHgU2l0lMb7dRl',
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, likeActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: 'https://activityhandler-social.test/user/undoer2/undo/1/activityhandler-social.test/user/undoer10/like/1/activityhandler.local.test/user/activityhandlertestok/note/nhzIHLcnHgU2l0lMb7dRl',
      object: likeActivity.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', likeActivity)
    )
  })
  it('can handle an undo for a share activity', async () => {
    const actor = await makeActor('undoer11')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: '1lLOwN_Xo6NOitowWyMYM'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const activity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: nockFormat({ username: 'undoer11', type: 'announce', num: 1, obj: note.id }),
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', activity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer11', type: 'undo', num: 1, obj: activity.id }),
      object: {
        type: activity.type,
        id: activity.id,
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'likes', activity)
    )
  })
  it('can ignore an undo for a share activity with a different actor', async () => {
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'kmK_TdUg1l8hasDwa7hGo'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const sharer = await makeActor('sharer10', 'activityhandler-third.test')
    const shareActivity = await as2.import({
      type: 'Announce',
      actor: sharer.id,
      id: nockFormat({ domain: 'activityhandler-third.test', username: 'sharer10', type: 'announce', num: 1, obj: note.id }),
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, shareActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
    const undoer = await makeActor('undoer12', 'activityhandler-social.test')
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: undoer.id,
      id: nockFormat({ domain: 'activityhandler-social.test', username: 'undoer12', type: 'undo', num: 1, obj: shareActivity.id }),
      object: {
        type: 'Announce',
        id: shareActivity.id
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
  })
  it('can ignore an undo for a share activity of a remote object', async () => {
    const actor = await makeActor('undoer13')
    const remoteObjectId = nockFormat({ domain: 'activityhandler-third.test', username: 'other', type: 'note', num: 1 })
    const announceActivityId = nockFormat({ username: 'undoer13', type: 'announce', num: 1, obj: remoteObjectId })
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer13', type: 'undo', num: 1, obj: announceActivityId }),
      object: {
        type: 'Announce',
        id: announceActivityId,
        actor: actor.id,
        object: remoteObjectId,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a share activity of a non-existent object', async () => {
    const actor = await makeActor('undoer14')
    const dne = formatter.format({ username: botName, type: 'note', nanoid: 'doesnotexist' })
    const announceActivityId = nockFormat({ username: 'undoer14', type: 'announce', num: 1, obj: dne })
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer14', type: 'undo', num: 1, obj: announceActivityId }),
      object: {
        type: 'Announce',
        id: announceActivityId,
        actor: actor.id,
        object: dne,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a share activity of an unreadable object', async () => {
    const actor = await makeActor('undoer15')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'mQ--bYVZLm9miMOUrbYU5'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: formatter.format({ username: botName, collection: 'followers' })
    })
    await objectStorage.create(note)
    const announceActivityId = nockFormat({ username: 'undoer15', type: 'announce', num: 1, obj: note.id })
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer15', type: 'undo', num: 1, obj: announceActivityId }),
      object: {
        type: 'Announce',
        id: announceActivityId,
        actor: actor.id,
        object: note.id,
        to: [botId]
      },
      to: [botId]
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a share activity of a blocked actor', async () => {
    const actor = await makeActor('undoer16')
    await actorStorage.addToCollection(botName, 'blocked', actor)
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'fbsPvVofkIcWt8HZA7NpK'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const shareActivityId = nockFormat({ username: 'undoer16', type: 'announce', num: 1, obj: note.id })
    const activity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer16', type: 'undo', num: 1, obj: shareActivityId }),
      object: {
        type: 'Announce',
        id: shareActivityId,
        actor: actor.id,
        object: note.id,
        to: [botId]
      },
      to: [botId]
    })
    await handler.handleActivity(bot, activity)
    assert.ok(true)
  })
  it('can ignore an undo for a share activity that has already been undone', async () => {
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: '0YpKR9l9ugvaAx2V-WPUd'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const actor = await makeActor('undoer17')
    const shareActivity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: nockFormat({ username: 'undoer17', type: 'announce', num: 1, obj: note.id }),
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, shareActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer17', type: 'undo', num: 1, obj: shareActivity.id }),
      object: {
        type: 'Announce',
        id: shareActivity.id,
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
    const duplicateActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer17', type: 'undo', num: 2, obj: shareActivity.id }),
      object: {
        type: 'Announce',
        id: shareActivity.id,
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, duplicateActivity)
    assert.ok(true)
  })
  it('can handle an undo for a share activity followed by another share', async () => {
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'DzCmKY2rzy7tWNr7CJvf1'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const actor = await makeActor('undoer18')
    const shareActivity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: nockFormat({ username: 'undoer18', type: 'announce', num: 1, obj: note.id }),
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, shareActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer18', type: 'undo', num: 1, obj: shareActivity.id }),
      object: {
        type: 'Announce',
        id: shareActivity.id,
        actor: actor.id,
        object: note.id,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
    const reShareActivity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: nockFormat({ username: 'undoer18', type: 'announce', num: 2, obj: note.id }),
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, reShareActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', reShareActivity)
    )
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
  })
  it('can handle an undo for a share activity by id', async () => {
    const actor = await makeActor('undoer19')
    const note = await as2.import({
      attributedTo: botId,
      id: formatter.format({
        username: botName,
        type: 'note',
        nanoid: 'YYTvtiZm4h9J8jMsWS3Gq'
      }),
      type: 'Note',
      content: 'Hello, world!',
      to: 'as:Public'
    })
    await objectStorage.create(note)
    const shareActivity = await as2.import({
      type: 'Announce',
      actor: actor.id,
      id: nockFormat({ username: 'undoer19', type: 'announce', num: 1, obj: note.id }),
      object: note.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, shareActivity)
    assert.strictEqual(
      true,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer19', type: 'undo', num: 1, obj: shareActivity.id }),
      object: shareActivity.id,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await objectStorage.isInCollection(note.id, 'shares', shareActivity)
    )
  })
  it('can handle an undo for a block activity', async () => {
    const actor = await makeActor('undoer20')
    const blockActivity = await as2.import({
      type: 'Block',
      actor: actor.id,
      id: nockFormat({ username: 'undoer20', type: 'block', num: 1, obj: botId }),
      object: botId,
      to: botId
    })
    await handler.handleActivity(bot, blockActivity)
    assert.ok(true)
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer20', type: 'undo', num: 1, obj: blockActivity.id }),
      object: {
        type: 'Block',
        id: blockActivity.id,
        actor: actor.id,
        object: botId,
        to: botId
      },
      to: botId
    })
    await handler.handleActivity(bot, undoActivity)
    assert.ok(true)
  })
  it('can handle an undo for a block activity by id', async () => {
    const actor = await makeActor('undoer21')
    const blockActivity = await as2.import({
      type: 'Block',
      actor: actor.id,
      id: nockFormat({ username: 'undoer21', type: 'block', num: 1, obj: botId }),
      object: botId,
      to: botId
    })
    await handler.handleActivity(bot, blockActivity)
    assert.ok(true)
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer21', type: 'undo', num: 1, obj: blockActivity.id }),
      object: blockActivity.id,
      to: botId
    })
    await handler.handleActivity(bot, undoActivity)
    assert.ok(true)
  })

  it('can ignore an undo for a block activity of another user', async () => {
    const actor = await makeActor('undoer22')
    const otherId = nockFormat({ username: 'other', domain: 'activityhandler-third.test' })
    const blockActivity = await as2.import({
      type: 'Block',
      actor: actor.id,
      id: nockFormat({ username: 'undoer22', type: 'block', num: 1, obj: otherId }),
      object: otherId,
      to: ['as:Public']
    })
    await handler.handleActivity(bot, blockActivity)
    assert.ok(true)
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username: 'undoer22', type: 'undo', num: 1, obj: blockActivity.id }),
      object: {
        type: 'Block',
        id: blockActivity.id,
        actor: actor.id,
        object: otherId,
        to: ['as:Public']
      },
      to: ['as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.ok(true)
  })
  it('can handle an undo for a follow activity', async () => {
    const username = 'undoer23'
    const actor = await makeActor(username)
    const followActivity = await as2.import({
      type: 'Follow',
      actor: actor.id,
      id: nockFormat({ username, type: 'follow', num: 1, obj: botId }),
      object: botId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, followActivity)
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 1, obj: followActivity.id }),
      object: {
        type: 'Follow',
        id: followActivity.id,
        actor: actor.id,
        object: botId,
        to: [botId, 'as:Public']
      },
      to: botId
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
  })
  it('can handle an undo for a follow by id', async () => {
    const username = 'undoer24'
    const actor = await makeActor(username)
    const followActivityId = nockFormat({ username, type: 'follow', num: 1, obj: botId })
    const followActivity = await as2.import({
      type: 'Follow',
      actor: actor.id,
      id: followActivityId,
      object: botId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, followActivity)
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 1, obj: followActivity.id }),
      object: followActivityId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
  })
  it('can ignore an undo for a follow activity of another user', async () => {
    const username = 'undoer25'
    const actor = await makeActor(username)
    const otherId = nockFormat({ username: 'other', domain: 'activityhandler-third.test' })
    const followActivity = await as2.import({
      type: 'Follow',
      actor: actor.id,
      id: nockFormat({ username, type: 'follow', num: 1, obj: otherId }),
      object: otherId,
      to: ['as:Public']
    })
    await handler.handleActivity(bot, followActivity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 1, obj: followActivity.id }),
      object: {
        type: 'Follow',
        id: followActivity.id,
        actor: actor.id,
        object: otherId,
        to: ['as:Public']
      },
      to: ['as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.ok(true)
  })
  it('can ignore an undo for a follow activity by another user', async () => {
    const username = 'undoer26'
    const otherName = 'other'
    const actor = await makeActor(username)
    const other = await makeActor(otherName, 'activityhandler-third.test')
    const followActivity = await as2.import({
      type: 'Follow',
      actor: other.id,
      id: nockFormat({ domain: 'activityhandler-third.test', username: otherName, type: 'follow', num: 1, obj: botId }),
      object: botId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, followActivity)
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'followers', other)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 1, obj: followActivity.id }),
      object: {
        type: 'Follow',
        id: followActivity.id,
        actor: other.id,
        object: botId,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'followers', other)
    )
  })
  it('can handle an undo for a follow activity followed by another follow', async () => {
    const username = 'undoer27'
    const actor = await makeActor(username)
    const followActivity = await as2.import({
      type: 'Follow',
      actor: actor.id,
      id: nockFormat({ username, type: 'follow', num: 1, obj: botId }),
      object: botId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, followActivity)
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 1, obj: followActivity.id }),
      object: {
        type: 'Follow',
        id: followActivity.id,
        actor: actor.id,
        object: botId,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const reFollowActivity = await as2.import({
      type: 'Follow',
      actor: actor.id,
      id: nockFormat({ username, type: 'follow', num: 2, obj: botId }),
      object: botId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, reFollowActivity)
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
  })
  it('can ignore an undo for a follow activity that has already been undone', async () => {
    const username = 'undoer28'
    const actor = await makeActor(username)
    const followActivity = await as2.import({
      type: 'Follow',
      actor: actor.id,
      id: nockFormat({ username, type: 'follow', num: 1, obj: botId }),
      object: botId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, followActivity)
    assert.strictEqual(
      true,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 1, obj: followActivity.id }),
      object: {
        type: 'Follow',
        id: followActivity.id,
        actor: actor.id,
        object: botId,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const duplicateActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 2, obj: followActivity.id }),
      object: {
        type: 'Follow',
        id: followActivity.id,
        actor: actor.id,
        object: botId,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, duplicateActivity)
    assert.ok(true)
  })
  it('can ignore an undo for a follow activity by a blocked actor', async () => {
    const username = 'undoer29'
    const actor = await makeActor(username)
    await actorStorage.addToCollection(botName, 'blocked', actor)
    const followActivity = await as2.import({
      type: 'Follow',
      actor: actor.id,
      id: nockFormat({ username, type: 'follow', num: 1, obj: botId }),
      object: botId,
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, followActivity)
    assert.strictEqual(
      false,
      await actorStorage.isInCollection(botName, 'followers', actor)
    )
    const undoActivity = await as2.import({
      type: 'Undo',
      actor: actor.id,
      id: nockFormat({ username, type: 'undo', num: 1, obj: followActivity.id }),
      object: {
        type: 'Follow',
        id: followActivity.id,
        actor: actor.id,
        object: botId,
        to: [botId, 'as:Public']
      },
      to: [botId, 'as:Public']
    })
    await handler.handleActivity(bot, undoActivity)
    assert.ok(true)
  })
  it('manages a thread with a direct reply', async () => {
    const idProps = {
      username: botName,
      type: 'note',
      nanoid: 'lbsAZQ6JeLiq060MgImdF'
    }
    const oid = formatter.format(idProps)
    const threadId = formatter.format({ ...idProps, collection: 'thread' })
    const original = await as2.import({
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://purl.archive.org/socialweb/thread/1.0'
      ],
      id: oid,
      type: 'Note',
      attributedTo: formatter.format({ username: botName }),
      to: 'as:Public',
      content: 'Original note',
      thread: threadId,
      context: threadId
    })
    await objectStorage.create(original)
    await objectStorage.addToCollection(oid, 'thread', original)
    const activity = await as2.import({
      type: 'Create',
      actor: 'https://activityhandler-social.test/user/remote1',
      id: 'https://activityhandler-social.test/user/remote1/object/23',
      object: {
        inReplyTo: oid,
        id: 'https://activityhandler-social.test/user/remote1/object/24',
        type: 'Note',
        content: 'Reply note',
        to: 'as:Public',
        thread: threadId
      },
      to: 'as:Public'
    })
    await handler.handleActivity(bot, activity)
    const collection2 = await objectStorage.getCollection(oid, 'thread')
    assert.equal(collection2.totalItems, 2)
    await handler.onIdle()
  })
})
