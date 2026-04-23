import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'

import { makeApp } from '../lib/app.js'
import OKBot from '../lib/bots/ok.js'

import { getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

describe('nodeinfo routes', async () => {
  const LOCAL_HOST = 'local.routes-nodeinfo.test'
  const BOT_USERNAME = 'routesnodeinfotestbot'
  const databaseUrl = getTestDatabaseUrl()
  const origin = `https://${LOCAL_HOST}`
  const testBots = {
    [BOT_USERNAME]: new OKBot(BOT_USERNAME)
  }
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

  describe('GET /.well-known/nodeinfo', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/.well-known/nodeinfo')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return JSON', async () => {
      assert.strictEqual(response.type, 'application/json')
    })
    it('should return an object with a links array', async () => {
      assert.strictEqual(Array.isArray(response.body.links), true)
    })
    it('should include a link with rel for nodeinfo 2.0', async () => {
      const link = response.body.links.find(
        l => l.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.0'
      )
      assert.ok(link, 'expected a link with rel for schema 2.0')
      assert.strictEqual(typeof link.href, 'string')
    })
    it('should point the 2.0 link href at this origin', async () => {
      const link = response.body.links.find(
        l => l.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.0'
      )
      assert.ok(link.href.startsWith(origin), `href ${link.href} should start with ${origin}`)
    })
  })

  describe('GET the 2.0 document the discovery doc links to', async () => {
    let response = null
    it('should work without an error', async () => {
      const discovery = await request(app).get('/.well-known/nodeinfo')
      const link = discovery.body.links.find(
        l => l.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.0'
      )
      const path = new URL(link.href).pathname
      response = await request(app).get(path)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return JSON', async () => {
      assert.strictEqual(response.type, 'application/json')
    })
    it('should return an object with version "2.0"', async () => {
      assert.strictEqual(response.body.version, '2.0')
    })

    it('should return an object with a software object', async () => {
      assert.strictEqual(typeof response.body.software, 'object')
      assert.ok(response.body.software !== null)
    })
    it('should return software.name as a schema-compliant string', async () => {
      assert.strictEqual(typeof response.body.software.name, 'string')
      assert.match(response.body.software.name, /^[a-z0-9-]+$/)
    })
    it('should return software.version as a string', async () => {
      assert.strictEqual(typeof response.body.software.version, 'string')
    })

    it('should return a protocols array', async () => {
      assert.strictEqual(Array.isArray(response.body.protocols), true)
    })
    it('should include "activitypub" in the protocols array', async () => {
      assert.ok(response.body.protocols.includes('activitypub'))
    })

    it('should return a services object', async () => {
      assert.strictEqual(typeof response.body.services, 'object')
      assert.ok(response.body.services !== null)
    })
    it('should return services.inbound as an array', async () => {
      assert.strictEqual(Array.isArray(response.body.services.inbound), true)
    })
    it('should return services.outbound as an array', async () => {
      assert.strictEqual(Array.isArray(response.body.services.outbound), true)
    })

    it('should return openRegistrations as a boolean', async () => {
      assert.strictEqual(typeof response.body.openRegistrations, 'boolean')
    })

    it('should return a usage object', async () => {
      assert.strictEqual(typeof response.body.usage, 'object')
      assert.ok(response.body.usage !== null)
    })
    it('should return usage.users as an object', async () => {
      assert.strictEqual(typeof response.body.usage.users, 'object')
      assert.ok(response.body.usage.users !== null)
    })
    it('should return usage.users.total as a non-negative integer', async () => {
      assert.strictEqual(typeof response.body.usage.users.total, 'number')
      assert.ok(Number.isInteger(response.body.usage.users.total))
      assert.ok(response.body.usage.users.total >= 0)
    })

    it('should return a metadata object', async () => {
      assert.strictEqual(typeof response.body.metadata, 'object')
      assert.ok(response.body.metadata !== null)
      assert.ok(!Array.isArray(response.body.metadata))
    })
  })
})
