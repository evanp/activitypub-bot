import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

import request from 'supertest'
import { nockSetup, nockSignature, nockFormat, makeActor, resetInbox, postInbox } from '@evanp/activitypub-nock'

import { makeApp } from '../lib/app.js'
import as2 from '../lib/activitystreams.js'
import { makeDigest } from './utils/digest.js'
import bots from './fixtures/bots.js'

describe('RelayServerBot', async () => {
  const host = 'activitypubbot.example'
  const origin = `https://${host}`
  const databaseUrl = 'sqlite::memory:'
  const remote = 'social.example'
  const relayServerBot = '_____relayserver_____'
  let app = null
  let formatter = null

  before(async () => {
    nockSetup(remote)
    app = await makeApp(databaseUrl, origin, bots, 'silent')
    formatter = app.locals.formatter
  })

  it('can get the actor for the relay server', async () => {
    const path = `/user/${relayServerBot}`
    const response = await request(app).get(path)
    assert.ok(response)
    assert.strictEqual(response.status, 200)
  })

  describe('follow activity for Public', async () => {
    const username = 'client0'
    const path = `/user/${relayServerBot}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    let response = null
    let signature = null
    let body = null
    let digest = null
    let activity = null
    let actor = null
    before(async () => {
      actor = await makeActor(username, remote)
      activity = await as2.import({
        type: 'Follow',
        actor: actor.id,
        id: nockFormat({ username, type: 'follow', num: 1 }),
        object: 'as:Public',
        to: formatter.format({ username: relayServerBot })
      })
      body = await activity.write()
      digest = makeDigest(body)
      signature = await nockSignature({
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
