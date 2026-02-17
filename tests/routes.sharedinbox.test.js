import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import as2 from '../lib/activitystreams.js'
import request from 'supertest'
import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'
import {
  nockSetup,
  nockSignature,
  nockFormat,
  makeActor,
  addFollower,
  addFollowing,
  addToCollection
} from '@evanp/activitypub-nock'
import { makeDigest } from './utils/digest.js'
import EventLoggingBot from './fixtures/eventloggingbot.js'
import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'

describe('routes.sharedinbox', async () => {
  const LOCAL_HOST = 'local.routes-sharedinbox.test'
  const REMOTE_HOST = 'remote.routes-sharedinbox.test'
  const BOT_READONLY = 'routesharedinboxtestreadonly'
  const BOT_DIRECT = 'routesharedinboxtestdirect'
  const BOT_FOLLOWERS_ONLY_1 = 'routesharedinboxtestfol1'
  const BOT_FOLLOWERS_ONLY_2 = 'routesharedinboxtestfol2'
  const BOT_LOCAL_FOLLOWERS_1 = 'routesharedinboxtestlf1'
  const BOT_LOCAL_FOLLOWERS_2 = 'routesharedinboxtestlf2'
  const BOT_LOCAL_FOLLOWERS_3 = 'routesharedinboxtestlf3'
  const FOLLOWED_BOT = 'routesharedinboxtestfollowed'
  const BOT_LOCAL_FOLLOWING_1 = 'routesharedinboxtestlwg1'
  const BOT_LOCAL_FOLLOWING_2 = 'routesharedinboxtestlwg2'
  const FOLLOWING_BOT = 'routesharedinboxtestfollowing'
  const BOT_REMOTE_FOLLOWING_1 = 'routesharedinboxtestrwg1'
  const BOT_REMOTE_FOLLOWING_2 = 'routesharedinboxtestrwg2'
  const BOT_REMOTE_FOLLOWING_3 = 'routesharedinboxtestrwg3'
  const BOT_REMOTE_COLLECTION_1 = 'routesharedinboxtestrc1'
  const BOT_REMOTE_COLLECTION_2 = 'routesharedinboxtestrc2'
  const BOT_REMOTE_COLLECTION_3 = 'routesharedinboxtestrc3'
  const LOGGING_BOT = 'routesharedinboxtestlogging'
  const REMOTE_ACTOR_1 = 'routesharedinboxtestactor1'
  const REMOTE_ACTOR_2 = 'routesharedinboxtestactor2'
  const REMOTE_ACTOR_3 = 'routesharedinboxtestactor3'
  const REMOTE_ACTOR_4 = 'routesharedinboxtestactor4'
  const REMOTE_ACTOR_5 = 'routesharedinboxtestactor5'
  const REMOTE_ACTOR_6 = 'routesharedinboxtestactor6'
  const REMOTE_ACTOR_7 = 'routesharedinboxtestactor7'
  const REMOTE_ACTOR_8 = 'routesharedinboxtestactor8'
  const BOT_NAMES_FOLLOWERS_ONLY = [BOT_FOLLOWERS_ONLY_1, BOT_FOLLOWERS_ONLY_2]
  const BOT_NAMES_LOCAL_FOLLOWERS = [BOT_LOCAL_FOLLOWERS_1, BOT_LOCAL_FOLLOWERS_2, BOT_LOCAL_FOLLOWERS_3]
  const BOT_NAMES_LOCAL_FOLLOWING = [BOT_LOCAL_FOLLOWING_1, BOT_LOCAL_FOLLOWING_2]
  const BOT_NAMES_REMOTE_FOLLOWING = [BOT_REMOTE_FOLLOWING_1, BOT_REMOTE_FOLLOWING_2, BOT_REMOTE_FOLLOWING_3]
  const BOT_NAMES_REMOTE_COLLECTION = [BOT_REMOTE_COLLECTION_1, BOT_REMOTE_COLLECTION_2, BOT_REMOTE_COLLECTION_3]
  const doNothingBotUsernames = [
    BOT_READONLY,
    BOT_DIRECT,
    ...BOT_NAMES_FOLLOWERS_ONLY,
    ...BOT_NAMES_LOCAL_FOLLOWERS,
    FOLLOWED_BOT,
    ...BOT_NAMES_LOCAL_FOLLOWING,
    FOLLOWING_BOT,
    ...BOT_NAMES_REMOTE_FOLLOWING,
    ...BOT_NAMES_REMOTE_COLLECTION
  ]
  const TEST_USERNAMES = [...doNothingBotUsernames, LOGGING_BOT]
  const loggingBot = new EventLoggingBot(LOGGING_BOT)
  const testBots = Object.fromEntries(
    doNothingBotUsernames.map((username) => [username, new DoNothingBot(username)])
  )
  testBots[LOGGING_BOT] = loggingBot
  const host = LOCAL_HOST
  const remoteHost = REMOTE_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null
  let formatter = null
  let actorStorage = null

  function nockFormatDefault (params) {
    return nockFormat({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  function nockSignatureDefault (params) {
    return nockSignature({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  function makeActorDefault (username, domain = REMOTE_HOST) {
    return makeActor(username, domain)
  }

  function addFollowerDefault (username, botId, domain = REMOTE_HOST) {
    return addFollower(username, botId, domain)
  }

  function addFollowingDefault (username, botId, domain = REMOTE_HOST) {
    return addFollowing(username, botId, domain)
  }

  function addToCollectionDefault (username, collection, botId, domain = REMOTE_HOST) {
    return addToCollection(username, collection, botId, domain)
  }

  before(async () => {
    nockSetup(remoteHost)
    app = await makeApp(databaseUrl, origin, testBots, 'silent')
    formatter = app.locals.formatter
    actorStorage = app.locals.actorStorage
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
  })

  after(async () => {
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await app.cleanup()
    app = null
  })

  describe('can handle an directly addressed activity', async () => {
    const username = REMOTE_ACTOR_1
    const botName = BOT_DIRECT
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    before(async () => {
      activity = await as2.import({
        type: 'Activity',
        actor: nockFormatDefault({ username }),
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: formatter.format({ username: botName })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should appear in the inbox', async () => {
      assert.strictEqual(
        true,
        await actorStorage.isInCollection(
          botName,
          'inbox',
          activity
        )
      )
    })
  })

  describe('can handle an followers-only activity', async () => {
    const username = REMOTE_ACTOR_2
    const botNames = BOT_NAMES_FOLLOWERS_ONLY
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActorDefault(username)
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        addFollowerDefault(username, botId)
        await actorStorage.addToCollection(botName, 'following', actor)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: nockFormatDefault({ username, collection: 'followers' })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should appear in all inboxes', async () => {
      for (const botName of botNames) {
        assert.strictEqual(
          true,
          await actorStorage.isInCollection(
            botName,
            'inbox',
            activity
          )
        )
      }
    })
  })

  describe('can handle a public activity', async () => {
    const username = REMOTE_ACTOR_3
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActorDefault(username)
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: 'as:Public'
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should appear in all inboxes', async () => {
      const lb = loggingBot
      assert.ok(lb.publics.has(activity.id))
    })
  })

  describe('can handle an activity to local followers collection', async () => {
    const username = REMOTE_ACTOR_4
    const botNames = BOT_NAMES_LOCAL_FOLLOWERS
    const followedBot = FOLLOWED_BOT
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActorDefault(username)
      const followed = await as2.import({
        id: formatter.format({ username: followedBot })
      })
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        const bot = await as2.import({ id: botId })
        await actorStorage.addToCollection(followedBot, 'followers', bot)
        await actorStorage.addToCollection(botName, 'following', followed)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: formatter.format({ username: followedBot, collection: 'followers' })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should appear in all inboxes', async () => {
      for (const botName of botNames) {
        assert.strictEqual(
          true,
          await actorStorage.isInCollection(
            botName,
            'inbox',
            activity
          )
        )
      }
    })
  })

  describe('can handle an activity to local following collection', async () => {
    const username = REMOTE_ACTOR_5
    const botNames = BOT_NAMES_LOCAL_FOLLOWING
    const followingBot = FOLLOWING_BOT
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActorDefault(username)
      const following = await as2.import({
        id: formatter.format({ username: followingBot })
      })
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        const bot = await as2.import({ id: botId })
        await actorStorage.addToCollection(followingBot, 'following', bot)
        await actorStorage.addToCollection(botName, 'followers', following)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: formatter.format({
          username: followingBot,
          collection: 'following'
        })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should appear in all inboxes', async () => {
      for (const botName of botNames) {
        assert.strictEqual(
          true,
          await actorStorage.isInCollection(
            botName,
            'inbox',
            activity
          )
        )
      }
    })
  })

  describe('can handle an activity to remote following collection', async () => {
    const username = REMOTE_ACTOR_6
    const botNames = BOT_NAMES_REMOTE_FOLLOWING
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActorDefault(username)
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        addFollowingDefault(username, botId)
        await actorStorage.addToCollection(botName, 'followers', actor)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: nockFormatDefault({ username, collection: 'following' })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should appear in all inboxes', async () => {
      for (const botName of botNames) {
        assert.strictEqual(
          true,
          await actorStorage.isInCollection(
            botName,
            'inbox',
            activity
          )
        )
      }
    })
  })

  describe('can handle an activity to remote actor collection', async () => {
    const username = REMOTE_ACTOR_7
    const botNames = BOT_NAMES_REMOTE_COLLECTION
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const collection = 1
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActorDefault(username)
      for (const botName of botNames) {
        const botId = formatter.format({ username: botName })
        addToCollectionDefault(username, collection, botId)
      }
      activity = await as2.import({
        type: 'Activity',
        actor: actor.id,
        id: nockFormatDefault({ username, type: 'activity', num: 1 }),
        to: nockFormatDefault({ username, type: 'collection', num: collection })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })
    it('should appear in all inboxes', async () => {
      for (const botName of botNames) {
        assert.strictEqual(
          true,
          await actorStorage.isInCollection(
            botName,
            'inbox',
            activity
          )
        )
      }
    })
  })

  describe('rejects a non-activity', async () => {
    const username = REMOTE_ACTOR_8
    const path = '/shared/inbox'
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let note
    let body
    let digest
    let signature
    before(async () => {
      note = await as2.import({
        type: 'Note',
        attributedTo: nockFormatDefault({ username }),
        to: 'as:Public',
        id: nockFormatDefault({ username, type: 'Note', num: 1 })
      })
      body = await note.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })
    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })
    it('should return a 400 status', async () => {
      assert.strictEqual(response.status, 400)
    })
  })
})
