import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import { getTestDatabaseUrl } from './utils/db.js'

const AS2_TYPES = [
  'application/activity+json',
  'application/ld+json',
  'application/json'
]

const BROWSER_TYPES = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'

describe('server routes', async () => {
  const LOCAL_HOST = 'local.routes-server.test'
  const databaseUrl = getTestDatabaseUrl()
  const origin = `https://${LOCAL_HOST}`
  const testBots = {}
  let app = null

  before(async () => {
    app = await makeApp({
      databaseUrl, origin, bots: testBots, logLevel: 'silent'
    })
  })

  after(async () => {
    if (!app) {
      return
    }
    await app.cleanup()
    app = null
  })

  describe('GET server actor', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/actor').set('Accept', AS2_TYPES.join(','))
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
    it('should return an object with the server actor id', async () => {
      assert.strictEqual(response.body.id, `${origin}/actor`)
    })
    it('should return an object with a public addressee', async () => {
      assert.strictEqual(response.body.to, 'as:Public')
    })
    it('should return an object with a publicKey', async () => {
      assert.strictEqual(typeof response.body.publicKey, 'object')
      assert.strictEqual(typeof response.body.publicKey.id, 'string')
      assert.strictEqual(typeof response.body.publicKey.owner, 'string')
      assert.strictEqual(typeof response.body.publicKey.type, 'string')
      assert.strictEqual(response.body.publicKey.type, 'CryptographicKey')
      assert.strictEqual(typeof response.body.publicKey.to, 'string')
      assert.strictEqual(response.body.publicKey.to, 'as:Public')
    })
    it('should include webfinger', async () => {
      assert.strictEqual(typeof response.body.webfinger, 'string')
      assert.strictEqual(response.body.webfinger, `${LOCAL_HOST}@${LOCAL_HOST}`)
    })
    it('should include alsoKnownAs', async () => {
      assert.strictEqual(typeof response.body.alsoKnownAs, 'string')
      assert.strictEqual(response.body.alsoKnownAs, `acct:${LOCAL_HOST}@${LOCAL_HOST}`)
    })
    it('should include preferredUsername', async () => {
      assert.strictEqual(typeof response.body.preferredUsername, 'string')
      assert.strictEqual(response.body.preferredUsername, LOCAL_HOST)
    })
    it('should include name', async () => {
      assert.strictEqual(typeof response.body.name, 'string')
      assert.strictEqual(response.body.name, LOCAL_HOST)
    })
    it('should include the homepage URL', async () => {
      assert.strictEqual(typeof response.body.url, 'object')
      assert.strictEqual(typeof response.body.url.type, 'string')
      assert.strictEqual(response.body.url.type, 'Link')
      assert.strictEqual(typeof response.body.url.mediaType, 'string')
      assert.strictEqual(response.body.url.mediaType, 'text/html')
      assert.strictEqual(typeof response.body.url.href, 'string')
      assert.strictEqual(response.body.url.href, `${origin}/`)
    })
  })

  describe('GET server actor with application/activity+json', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/actor').set('Accept', 'application/activity+json')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
  })

  describe('GET server actor with application/ld+json', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/actor').set('Accept', 'application/ld+json')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
  })

  describe('GET server actor with application/json', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/actor').set('Accept', 'application/json')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return AS2', async () => {
      assert.strictEqual(response.type, 'application/activity+json')
    })
  })

  describe('GET server publickey', async () => {
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
      assert.strictEqual(response.body.owner, `${origin}/actor`)
    })
    it('should return an object with a publicKeyPem', async () => {
      assert.strictEqual(typeof response.body.publicKeyPem, 'string')
    })
    it('publicKeyPem should be an RSA PKCS-8 key', async () => {
      assert.match(response.body.publicKeyPem, /^-----BEGIN PUBLIC KEY-----\n/)
      assert.match(response.body.publicKeyPem, /\n-----END PUBLIC KEY-----\n$/)
    })
  })
  describe('GET home page', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/').set('Accept', BROWSER_TYPES)
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return HTML', async () => {
      assert.strictEqual(response.type, 'text/html')
    })
    it('should include the default title', async () => {
      assert.ok(response.text.match(/<title>activitypub.bot<\/title>/))
    })
  })
})
