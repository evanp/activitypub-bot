import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import { getTestDatabaseUrl } from './utils/db.js'

describe('server routes', async () => {
  const LOCAL_HOST = 'routes-server.local.test'
  const databaseUrl = getTestDatabaseUrl()
  const origin = `https://${LOCAL_HOST}`
  const testBots = {}
  let app = null

  before(async () => {
    app = await makeApp(databaseUrl, origin, testBots, 'silent')
  })

  after(async () => {
    if (!app) {
      return
    }
    await app.cleanup()
    app = null
  })

  describe('GET /', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with an id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
    })
    it('should return an object with an id matching the origin', async () => {
      assert.strictEqual(response.body.id, `${origin}/`)
    })
    it('should return an object with a publicKey', async () => {
      assert.strictEqual(typeof response.body.publicKey, 'string')
    })
  })
  describe('GET /publickey', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/publickey')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with an id', async () => {
      assert.strictEqual(typeof response.body.id, 'string')
    })
    it('should return an object with an id matching the origin', async () => {
      assert.strictEqual(response.body.id, `${origin}/publickey`)
    })
    it('should return an object with an owner', async () => {
      assert.strictEqual(typeof response.body.owner, 'string')
    })
    it('should return an object with the origin as owner', async () => {
      assert.strictEqual(response.body.owner, `${origin}/`)
    })
    it('should return an object with a publicKeyPem', async () => {
      assert.strictEqual(typeof response.body.publicKeyPem, 'string')
    })
    it('publicKeyPem should be an RSA PKCS-8 key', async () => {
      assert.match(response.body.publicKeyPem, /^-----BEGIN PUBLIC KEY-----\n/)
      assert.match(response.body.publicKeyPem, /\n-----END PUBLIC KEY-----\n$/)
    })
  })
})
