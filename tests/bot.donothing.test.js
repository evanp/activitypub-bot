import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import request from 'supertest'

import { makeApp } from '../lib/app.js'

import { nockSetup } from '@evanp/activitypub-nock'
import bots from './fixtures/bots.js'

describe('DoNothing bot', async () => {
  const host = 'activitypubbot.example'
  const origin = `https://${host}`
  const databaseUrl = 'sqlite::memory:'
  let app = null

  before(async () => {
    nockSetup('social.example')
    app = await makeApp(databaseUrl, origin, bots, 'silent')
  })

  describe('Bot exists', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/null')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
  })
})
