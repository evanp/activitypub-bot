import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'
import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'

describe('app', async () => {
  const LOCAL_HOST = 'local.app.test'
  const origin = `https://${LOCAL_HOST}`
  const BOT_USERNAME = 'apptestbot1'
  const TEST_USERNAMES = [BOT_USERNAME]
  const testBots = {
    [BOT_USERNAME]: new DoNothingBot(BOT_USERNAME)
  }
  const databaseUrl = getTestDatabaseUrl()
  let app = null

  before(async () => {
    app = await makeApp(databaseUrl, origin, testBots, 'silent')
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
  })

  after(async () => {
    if (!app) {
      return
    }
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST
    })
    await app.cleanup()
    app = null
  })

  it('should be a function', async () => {
    assert.strictEqual(typeof makeApp, 'function')
  })
  it('should return a function', async () => {
    assert.strictEqual(typeof app, 'function')
  })
})
