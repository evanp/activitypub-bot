import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'
import { nockSetup } from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'

import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'

describe('DoNothing bot', async () => {
  const LOCAL_HOST = 'local.bot-donothing.test'
  const REMOTE_HOST = 'remote.bot-donothing.test'
  const BOT_USERNAME_1 = 'botdonothingtest1'
  const BOT_USERNAME_2 = 'botdonothingtest2'
  const BOT_USERNAME_2_FULLNAME = 'A custom test bot full name'
  const BOT_USERNAME_2_DESCRIPTION = 'A custom test bot description'
  const BOT_USERNAME_2_IMAGE_URL =
    'https://site.example/images/123.jpg'
  const TEST_USERNAMES = [BOT_USERNAME_1, BOT_USERNAME_2]
  const testBots = {
    [BOT_USERNAME_1]: new DoNothingBot(BOT_USERNAME_1),
    [BOT_USERNAME_2]: new DoNothingBot(
      BOT_USERNAME_2,
      {
        fullname: BOT_USERNAME_2_FULLNAME,
        description: BOT_USERNAME_2_DESCRIPTION,
        icon: new URL('../web/icon.png', import.meta.url),
        image: new URL(BOT_USERNAME_2_IMAGE_URL)
      })
  }
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null

  before(async () => {
    nockSetup(REMOTE_HOST)
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent'
    })
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
  })

  describe('Bot exists', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${BOT_USERNAME_1}`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should have the default name', async () => {
      assert.strictEqual(typeof response.body, 'object')
      assert.strictEqual(typeof response.body.name, 'string')
      assert.strictEqual(response.body.name, 'Do Nothing Bot')
    })
    it('should have the default description', async () => {
      assert.strictEqual(typeof response.body, 'object')
      assert.strictEqual(typeof response.body.summary, 'string')
      assert.strictEqual(response.body.summary, 'A bot that does nothing.')
    })
  })

  describe('Custom bot exists', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get(`/user/${BOT_USERNAME_2}`)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should have a custom name', async () => {
      assert.strictEqual(typeof response.body, 'object')
      assert.strictEqual(typeof response.body.name, 'string')
      assert.strictEqual(response.body.name, BOT_USERNAME_2_FULLNAME)
    })
    it('should have a custom description', async () => {
      assert.strictEqual(typeof response.body, 'object')
      assert.strictEqual(typeof response.body.summary, 'string')
      assert.strictEqual(response.body.summary, BOT_USERNAME_2_DESCRIPTION)
    })
    it('should have a custom avatar', async () => {
      assert.strictEqual(typeof response.body, 'object')
      assert.strictEqual(typeof response.body.icon, 'object')
      assert.strictEqual(typeof response.body.icon.href, 'string')
      assert.strictEqual(response.body.icon.href, `${origin}/user/${BOT_USERNAME_2}/icon`)
      assert.strictEqual(typeof response.body.icon.type, 'string')
      assert.strictEqual(response.body.icon.type, 'Link')
    })
    it('should have a custom image', async () => {
      assert.strictEqual(typeof response.body, 'object')
      assert.strictEqual(typeof response.body.image, 'object')
      assert.strictEqual(typeof response.body.image.href, 'string')
      assert.strictEqual(response.body.image.href, BOT_USERNAME_2_IMAGE_URL)
      assert.strictEqual(typeof response.body.image.type, 'string')
      assert.strictEqual(response.body.image.type, 'Link')
    })
  })
})
