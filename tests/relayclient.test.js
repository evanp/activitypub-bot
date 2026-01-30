import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { BotContext } from '../lib/botcontext.js'
import { Sequelize } from 'sequelize'
import { BotDataStorage } from '../lib/botdatastorage.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { Transformer } from '../lib/microsyntax.js'
import {
  nockSetup,
  postInbox,
  resetInbox,
  makeActor,
  makeObject,
  nockFormat
} from '@evanp/activitypub-nock'
import Logger from 'pino'
import as2 from '../lib/activitystreams.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { runMigrations } from '../lib/migrations/index.js'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'

function isRelayFollow (activity) {
  return activity.type === `${AS2_NS}Follow` &&
    activity.object.first.id === `${AS2_NS}Public`
}

describe('BotContext', () => {
  const host = 'activitypubbot.example'
  const origin = `https://${host}`
  const botName = 'relayclient1'
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
  let RelayClientBot = null
  let relayName = 'relay0'
  let relay = null
  let bot = null

  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    formatter = new UrlFormatter(origin)
    connection = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    await connection.authenticate()
    await runMigrations(connection)
    botDataStorage = new BotDataStorage(connection)
    objectStorage = new ObjectStorage(connection)
    keyStorage = new KeyStorage(connection, logger)
    actorStorage = new ActorStorage(connection, formatter)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger)
    transformer = new Transformer(`${origin}/tag/`, client)
    context = new BotContext(
      botName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger
    )
    nockSetup('social.example')
    relay = nockFormat({ username: relayName })
  })
  after(async () => {
    await connection.close()
    context = null
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
    resetInbox()
  })

  it('can be imported', async () => {
    RelayClientBot = (await import('../lib/bots/relayclient.js')).default
    assert.ok(RelayClientBot)
    assert.equal(typeof RelayClientBot, 'function')
  })

  it('can be constructed', async () => {
    bot = new RelayClientBot(botName, relay)
    assert.ok(bot)
  })

  it('subscribes to a remote relay on initialize', async () => {
    await bot.initialize(context)
    await context.onIdle()
    assert.equal(postInbox[relayName], 1)

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

    assert.ok(foundInOutbox)
  })
})