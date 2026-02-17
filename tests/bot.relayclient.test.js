import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { BotContext } from '../lib/botcontext.js'
import { BotDataStorage } from '../lib/botdatastorage.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { Transformer } from '../lib/microsyntax.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'
import {
  nockSetup,
  postInbox,
  resetInbox,
  nockFormat
} from '@evanp/activitypub-nock'
import Logger from 'pino'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'
const LOCAL_HOST = 'bot-relayclient.local.test'
const REMOTE_HOST = 'bot-relayclient.remote.test'
const LOCAL_ORIGIN = `https://${LOCAL_HOST}`
const BOT_USERNAME = 'botrelayclienttest1'
const RELAY_USERNAME = 'botrelayclientrelay1'
const TEST_USERNAMES = [BOT_USERNAME]

function isRelayFollow (activity) {
  return activity.type === `${AS2_NS}Follow` &&
    activity.object.first.id === `${AS2_NS}Public`
}

describe('BotContext', () => {
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
  let RelayClientBot = null
  let relay = null
  let bot = null

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
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger)
    transformer = new Transformer(`${LOCAL_ORIGIN}/tag/`, client)
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
    nockSetup(REMOTE_HOST)
    relay = nockFormat({ username: RELAY_USERNAME, domain: REMOTE_HOST })
  })
  after(async () => {
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
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
    transformer = null
    logger = null
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
})
