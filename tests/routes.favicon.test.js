import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'

import { makeApp } from '../lib/app.js'

import { getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

const ROBOT_EMOJI = '\u{1F916}'

describe('GET /favicon.ico', async () => {
  const LOCAL_HOST = 'local.routes-favicon.test'
  const origin = `https://${LOCAL_HOST}`
  const databaseUrl = getTestDatabaseUrl()
  const testBots = {}
  let app = null

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent', redisUrl: getTestRedisUrl()
    })
  })

  after(async () => {
    await cleanupRedis(origin)
    if (!app) {
      return
    }
    await app.cleanup()
  })

  describe('unsigned request', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/favicon.ico')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return SVG', async () => {
      assert.strictEqual(response.type, 'image/svg+xml')
    })
    it('should contain the robot head emoji', async () => {
      const body = response.body instanceof Buffer ? response.body.toString('utf8') : response.text
      assert.ok(body.includes(ROBOT_EMOJI), `expected body to contain ${ROBOT_EMOJI}, got: ${body}`)
    })
  })
})
