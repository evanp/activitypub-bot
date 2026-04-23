import { describe, it, before } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import LoggingBot from '../lib/bots/logging.js'
import as2 from '../lib/activitystreams.js'

describe('LoggingBot', () => {
  const username = 'botloggingtest1'
  const origin = 'https://local.bot-logging.test'
  const botId = `${origin}/user/${username}`
  const remoteOrigin = 'https://remote.bot-logging.test'
  const remoteActorId = `${remoteOrigin}/users/alice`

  let bot = null
  let logger = null

  let actor = null
  let note = null
  let create = null
  let follow = null
  let like = null
  let announce = null
  let undo = null

  before(async () => {
    logger = Logger({ level: 'silent' })

    actor = await as2.import({
      id: remoteActorId,
      type: 'Person',
      preferredUsername: 'alice',
      inbox: `${remoteActorId}/inbox`
    })

    note = await as2.import({
      id: `${remoteOrigin}/notes/1`,
      type: 'Note',
      attributedTo: remoteActorId,
      content: 'hello world',
      to: 'https://www.w3.org/ns/activitystreams#Public'
    })

    create = await as2.import({
      id: `${remoteOrigin}/activities/create/1`,
      type: 'Create',
      actor: remoteActorId,
      object: note,
      to: 'https://www.w3.org/ns/activitystreams#Public'
    })

    follow = await as2.import({
      id: `${remoteOrigin}/activities/follow/1`,
      type: 'Follow',
      actor: remoteActorId,
      object: botId
    })

    like = await as2.import({
      id: `${remoteOrigin}/activities/like/1`,
      type: 'Like',
      actor: remoteActorId,
      object: note
    })

    announce = await as2.import({
      id: `${remoteOrigin}/activities/announce/1`,
      type: 'Announce',
      actor: remoteActorId,
      object: note,
      to: 'https://www.w3.org/ns/activitystreams#Public'
    })

    undo = await as2.import({
      id: `${remoteOrigin}/activities/undo/1`,
      type: 'Undo',
      actor: remoteActorId,
      object: follow
    })
  })

  it('can be imported', () => {
    assert.ok(LoggingBot)
    assert.strictEqual(typeof LoggingBot, 'function')
  })

  it('can be constructed', () => {
    bot = new LoggingBot(username)
    assert.ok(bot)
  })

  it('can be initialized with a minimal context', async () => {
    const ctx = {
      botId: username,
      logger: logger.child({ class: 'BotContext', botId: username })
    }
    await bot.initialize(ctx)
  })

  it('onMention does not throw', async () => {
    await assert.doesNotReject(() => bot.onMention(note, create))
  })

  it('onFollow does not throw', async () => {
    await assert.doesNotReject(() => bot.onFollow(actor, follow))
  })

  it('onLike does not throw', async () => {
    await assert.doesNotReject(() => bot.onLike(note, like))
  })

  it('onAnnounce does not throw', async () => {
    await assert.doesNotReject(() => bot.onAnnounce(note, announce))
  })

  it('onPublic does not throw', async () => {
    await assert.doesNotReject(() => bot.onPublic(create))
  })

  it('onUndoFollow does not throw', async () => {
    await assert.doesNotReject(() => bot.onUndoFollow(actor, undo, follow))
  })
})
