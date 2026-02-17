import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import request from 'supertest'
import { nockSetup, nockSignature, nockFormat, makeActor, resetInbox, postInbox } from '@evanp/activitypub-nock'
import { makeApp } from '../lib/app.js'
import RelayServerBot from '../lib/bots/relayserver.js'
import as2 from '../lib/activitystreams.js'
import { makeDigest } from './utils/digest.js'
import { cleanupTestData, getTestDatabaseUrl } from './utils/db.js'

describe('RelayServerBot', async () => {
  const LOCAL_HOST = 'local.bot-relayserver.test'
  const REMOTE_HOST = 'remote.bot-relayserver.test'
  const RELAY_SERVER_BOT_USERNAME = 'botrelayservertest'
  const REMOTE_CLIENT_USERNAME = 'botrelayserverclient1'
  const TEST_USERNAMES = [RELAY_SERVER_BOT_USERNAME]
  const host = LOCAL_HOST
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  const testBots = {
    [RELAY_SERVER_BOT_USERNAME]: new RelayServerBot(RELAY_SERVER_BOT_USERNAME)
  }
  let app = null
  let formatter = null

  function nockFormatDefault (params) {
    return nockFormat({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  function nockSignatureDefault (params) {
    return nockSignature({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  before(async () => {
    nockSetup(REMOTE_HOST)
    app = await makeApp(databaseUrl, origin, testBots, 'silent')
    await cleanupTestData(app.locals.connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    formatter = app.locals.formatter
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
    app = null
    formatter = null
  })

  it('can get the actor for the relay server', async () => {
    const path = `/user/${RELAY_SERVER_BOT_USERNAME}`
    const response = await request(app).get(path)
    assert.ok(response)
    assert.strictEqual(response.status, 200)
  })

  describe('follow activity for Public', async () => {
    const username = REMOTE_CLIENT_USERNAME
    const path = `/user/${RELAY_SERVER_BOT_USERNAME}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null

    before(async () => {
      actor = await makeActor(username, REMOTE_HOST)
      activity = await as2.import({
        type: 'Follow',
        actor: actor.id,
        id: nockFormatDefault({ username, type: 'follow', num: 1 }),
        object: 'as:Public',
        to: formatter.format({ username: RELAY_SERVER_BOT_USERNAME })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignatureDefault({
        method: 'POST',
        username,
        url,
        digest,
        date
      })
    })

    it('should work without an error', async () => {
      response = await request(app)
        .post(path)
        .send(body)
        .set('Signature', signature)
        .set('Date', date)
        .set('Host', host)
        .set('Digest', digest)
        .set('Content-Type', 'application/activity+json')
      assert.ok(response)
      await app.onIdle()
    })

    it('should return a 202 status', async () => {
      assert.strictEqual(response.status, 202)
    })

    it('should send an acceptance to the client', async () => {
      assert.ok(postInbox[username])
    })

    after(async () => {
      resetInbox()
    })
  })
})
