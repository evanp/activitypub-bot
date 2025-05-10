import { describe, it } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import bots from './fixtures/bots.js'

describe('health check routes', async () => {
  const databaseUrl = 'sqlite::memory:'
  const origin = 'https://activitypubbot.test'
  const app = await makeApp(databaseUrl, origin, bots)
  describe('GET /livez', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/livez')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return plain text', async () => {
      assert.strictEqual(response.type, 'text/plain')
    })
    it('should return an OK flag', async () => {
      assert.strictEqual(response.text, 'OK')
    })
  })
  describe('GET /readyz', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/readyz')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return plain text', async () => {
      assert.strictEqual(response.type, 'text/plain')
    })
    it('should return an OK flag', async () => {
      assert.strictEqual(response.text, 'OK')
    })
  })
})
