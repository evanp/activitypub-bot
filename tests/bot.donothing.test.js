import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import request from 'supertest'
import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'
import { nockSetup } from '@evanp/activitypub-nock'
import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'

describe('DoNothing bot', async () => {
  const LOCAL_HOST = 'local.bot-donothing.test'
  const REMOTE_HOST = 'remote.bot-donothing.test'
  const BOT_USERNAME = 'botdonothingtest'
  const TEST_USERNAMES = [BOT_USERNAME]
  const testBots = {
    [BOT_USERNAME]: new DoNothingBot(BOT_USERNAME)
  }
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null

  before(async () => {
    nockSetup(REMOTE_HOST)
    app = await makeApp(databaseUrl, origin, testBots, 'silent')
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

  describe('Bot exists', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${BOT_USERNAME}`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
  })
})
