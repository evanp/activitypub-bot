import { before, after, describe } from 'node:test'
import { makeApp } from '../lib/app.js'
import DoNothingBot from '../lib/bots/donothing.js'
import { noCorsTests } from './utils/cors.js'
import { cleanupRedis, getTestDatabaseUrl, getTestRedisUrl } from './utils/db.js'

describe('profile routes', () => {
  const origin = 'https://local.routes-profile.test'
  let app

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      origin,
      databaseUrl: getTestDatabaseUrl(),
      redisUrl: getTestRedisUrl(),
      bots: { corsprofilebot: new DoNothingBot('corsprofilebot') },
      logLevel: 'silent'
    })
  })

  after(async () => {
    await cleanupRedis(origin)
    if (app) await app.cleanup()
  })

  noCorsTests(() => app, () => [{ path: '/profile/corsprofilebot' }])
})
