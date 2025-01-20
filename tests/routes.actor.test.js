import { describe, it } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import bots from './fixtures/bots.js'

describe('actor routes', async () => {
  const databaseUrl = 'sqlite::memory:'
  const origin = 'https://activitypubbot.test'
  const app = await makeApp(databaseUrl, origin, bots)

  describe('GET /user/{botid}', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/ok')
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
    it('should return an object with an id matching the request', async () => {
      assert.strictEqual(response.body.id, origin + '/user/ok')
    })
    it('should return an object with a type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
    })
    it('should return an object with a type matching the request', async () => {
      assert.strictEqual(response.body.type, 'Service')
    })
    it('should return an object with a preferredUsername', async () => {
      assert.strictEqual(typeof response.body.preferredUsername, 'string')
    })
    it('should return an object with a preferredUsername matching the request', async () => {
      assert.strictEqual(response.body.preferredUsername, 'ok')
    })
    it('should return an object with an inbox', async () => {
      assert.strictEqual(typeof response.body.inbox, 'string')
    })
    it('should return an object with an outbox', async () => {
      assert.strictEqual(typeof response.body.outbox, 'string')
    })
    it('should return an object with a followers', async () => {
      assert.strictEqual(typeof response.body.followers, 'string')
    })
    it('should return an object with a following', async () => {
      assert.strictEqual(typeof response.body.following, 'string')
    })
    it('should return an object with a liked', async () => {
      assert.strictEqual(typeof response.body.liked, 'string')
    })
    it('should return an object with a to', async () => {
      assert.strictEqual(typeof response.body.to, 'string')
    })
    it('should return an object with a to matching the request', async () => {
      assert.strictEqual(response.body.to, 'as:Public')
    })
    it('should return an object with a summary', async () => {
      assert.strictEqual(typeof response.body.summary, 'string')
    })
    it('should return an object with a summary matching the request', async () => {
      assert.strictEqual(response.body.summary, 'A bot that says "OK" when mentioned.')
    })
    it('should return an object with a name', async () => {
      assert.strictEqual(typeof response.body.name, 'string')
    })
    it('should return an object with a name matching the request', async () => {
      assert.strictEqual(response.body.name, 'OK Bot')
    })
    it('should return an object with a publicKey', async () => {
      assert.strictEqual(typeof response.body.publicKey, 'object')
      assert.ok(response.body.publicKey)
    })
    it('should return an object with a publicKey matching the request', async () => {
      assert.strictEqual(response.body.publicKey.id, origin + '/user/ok/publickey')
    })
    it('should return an object with a publicKey with an owner matching the request', async () => {
      assert.strictEqual(response.body.publicKey.owner, origin + '/user/ok')
    })
    it('should return an object with a publicKey with a type', async () => {
      assert.strictEqual(response.body.publicKey.type, 'PublicKey')
    })
    it('should return an object with a publicKey with a to', async () => {
      assert.strictEqual(response.body.publicKey.to, 'as:Public')
    })
    it('should return an object with a publicKey with a publicKeyPem', async () => {
      assert.strictEqual(typeof response.body.publicKey.publicKeyPem, 'string')
    })
    it('publicKeyPem should be an RSA PKCS-8 key', async () => {
      assert.match(response.body.publicKey.publicKeyPem, /^-----BEGIN PUBLIC KEY-----\n/)
      assert.match(response.body.publicKey.publicKeyPem, /\n-----END PUBLIC KEY-----\n$/)
    })
  })

  describe('GET non-existent user', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/dne')
    })
    it('should return 404 Not Found', async () => {
      assert.strictEqual(response.status, 404)
    })
    it('should return Problem Details JSON', async () => {
      assert.strictEqual(response.type, 'application/problem+json')
    })
    it('should return an object', async () => {
      assert.strictEqual(typeof response.body, 'object')
    })
    it('should return an object with a type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
    })
    it('should return an object with an type matching the request', async () => {
      assert.strictEqual(response.body.type, 'about:blank')
    })
    it('should return an object with a title', async () => {
      assert.strictEqual(typeof response.body.title, 'string')
    })
    it('should return an object with a title matching the request', async () => {
      assert.strictEqual(response.body.title, 'Not Found')
    })
    it('should return an object with a status', async () => {
      assert.strictEqual(typeof response.body.status, 'number')
    })
    it('should return an object with a status matching the request', async () => {
      assert.strictEqual(response.body.status, 404)
    })
    it('should return an object with a detail', async () => {
      assert.strictEqual(typeof response.body.detail, 'string')
    })
    it('should return an object with a detail matching the request', async () => {
      assert.strictEqual(response.body.detail, 'User dne not found')
    })
  })
  describe('GET /user/{dne}/publickey', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/dne')
    })
    it('should return 404 Not Found', async () => {
      assert.strictEqual(response.status, 404)
    })
    it('should return Problem Details JSON', async () => {
      assert.strictEqual(response.type, 'application/problem+json')
    })
    it('should return the right object', async () => {
      assert.strictEqual(typeof response.body, 'object')
      assert.strictEqual(response.body.type, 'about:blank')
      assert.strictEqual(response.body.title, 'Not Found')
      assert.strictEqual(response.body.status, 404)
      assert.strictEqual(response.body.detail, 'User dne not found')
    })
  })

  describe('GET /user/{botid}/publickey', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/ok/publickey')
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
    it('should return an object with the requested public key id', async () => {
      assert.strictEqual(response.body.id, origin + '/user/ok/publickey')
    })
    it('should return an object with an owner', async () => {
      assert.strictEqual(typeof response.body.owner, 'string')
    })
    it('should return an object with the bot as owner', async () => {
      assert.strictEqual(response.body.owner, origin + '/user/ok')
    })
    it('should return an object with a publicKeyPem', async () => {
      assert.strictEqual(typeof response.body.publicKeyPem, 'string')
    })
    it('publicKeyPem should be an RSA PKCS-8 key', async () => {
      assert.match(response.body.publicKeyPem, /^-----BEGIN PUBLIC KEY-----\n/)
      assert.match(response.body.publicKeyPem, /\n-----END PUBLIC KEY-----\n$/)
    })
    it('should return an object with a type', async () => {
      assert.strictEqual(typeof response.body.type, 'string')
    })
    it('should return an object with a type matching the request', async () => {
      assert.strictEqual(response.body.type, 'PublicKey')
    })
    it('should return an object with a to', async () => {
      assert.strictEqual(typeof response.body.to, 'string')
    })
    it('should return an object with a to matching the request', async () => {
      assert.strictEqual(response.body.to, 'as:Public')
    })
  })
})
