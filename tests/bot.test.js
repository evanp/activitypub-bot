import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'

import Bot from '../lib/bot.js'
import { makeApp } from '../lib/app.js'

import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

class ApplicationBot extends Bot {
  get type () {
    return 'Application'
  }
}

describe('Bot interface', async () => {
  const LOCAL_HOST = 'local.bot.test'
  const origin = `https://${LOCAL_HOST}`
  const BOT_USERNAME = 'bottest1'
  const TEST_USERNAMES = [BOT_USERNAME]
  const databaseUrl = getTestDatabaseUrl()
  const redisUrl = getTestRedisUrl()
  const bots = {
    [BOT_USERNAME]: new ApplicationBot(BOT_USERNAME)
  }

  let app = null

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl,
      origin,
      bots,
      logLevel: 'silent',
      redisUrl
    })
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
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
    await app.cleanup()
  })

  it('serves the bot actor with the bot type', async () => {
    const response = await request(app)
      .get(`/user/${BOT_USERNAME}`)
      .set('Accept', 'application/activity+json')

    assert.strictEqual(response.status, 200)
    assert.strictEqual(response.body.type, 'Application')
  })
})
