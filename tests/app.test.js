import { describe, it } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import bots from './fixtures/bots.js'
import { getTestDatabaseUrl } from './utils/db.js'

describe('app', async () => {
  const databaseUrl = getTestDatabaseUrl()
  const origin = 'https://activitypubbot.test'
  let app = null
  it('should be a function', async () => {
    assert.strictEqual(typeof makeApp, 'function')
  })
  it('should return a function', async () => {
    app = await makeApp(databaseUrl, origin, bots, 'silent')
    assert.strictEqual(typeof app, 'function')
  })
})
