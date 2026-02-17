import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import request from 'supertest'
import as2 from '../lib/activitystreams.js'
import { getTestDatabaseUrl } from './utils/db.js'

import { makeApp } from '../lib/app.js'

import { nockSetup, nockSignature, nockFormat } from '@evanp/activitypub-nock'
import { makeDigest } from './utils/digest.js'

import bots from './fixtures/bots.js'

describe('ProvinceBotFactory', async () => {
  const host = 'local.botfactory-provincebotfactory.test'
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  let app = null

  before(async () => {
    nockSetup('social.botfactory-provincebotfactory.test')
    app = await makeApp(databaseUrl, origin, bots, 'silent')
  })

  describe('Webfinger discovery for province', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/.well-known/webfinger?resource=acct%3Aqc%40local.botfactory-provincebotfactory.test')
    })
    it('should return 200 OK', async () => {
      assert.strictEqual(response.status, 200)
    })
    it('should return JRD', async () => {
      assert.strictEqual(response.type, 'application/jrd+json')
    })
    it('should return an object with a subject', async () => {
      assert.strictEqual(typeof response.body.subject, 'string')
    })
    it('should return an object with an subject matching the request', async () => {
      assert.strictEqual(response.body.subject, 'acct:qc@local.botfactory-provincebotfactory.test')
    })
    it('should return an object with a links array', async () => {
      assert.strictEqual(Array.isArray(response.body.links), true)
    })
    it('should return an object with a links array containing the actor id', async () => {
      assert.strictEqual(response.body.links.length, 1)
      assert.strictEqual(typeof response.body.links[0].rel, 'string')
      assert.strictEqual(response.body.links[0].rel, 'self')
      assert.strictEqual(typeof response.body.links[0].type, 'string')
      assert.strictEqual(response.body.links[0].type, 'application/activity+json')
      assert.strictEqual(typeof response.body.links[0].href, 'string')
      assert.strictEqual(response.body.links[0].href, 'https://local.botfactory-provincebotfactory.test/user/qc')
    })
  })

  describe('Actor for province', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/qc')
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
      assert.strictEqual(response.body.id, origin + '/user/qc')
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
      assert.strictEqual(response.body.preferredUsername, 'qc')
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
      assert.strictEqual(response.body.summary, 'The province of Quebec')
    })
    it('should return an object with a name', async () => {
      assert.strictEqual(typeof response.body.name, 'string')
    })
    it('should return an object with a name matching the request', async () => {
      assert.strictEqual(response.body.name, 'Quebec')
    })
    it('should return an object with a publicKey', async () => {
      assert.strictEqual(typeof response.body.publicKey, 'object')
      assert.ok(response.body.publicKey)
    })
    it('should return an object with a publicKey matching the request', async () => {
      assert.strictEqual(response.body.publicKey.id, origin + '/user/qc/publickey')
    })
    it('should return an object with a publicKey with an owner matching the request', async () => {
      assert.strictEqual(response.body.publicKey.owner, origin + '/user/qc')
    })
    it('should return an object with a publicKey with a type', async () => {
      assert.strictEqual(response.body.publicKey.type, 'CryptographicKey')
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

  describe('Public key for province', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/qc/publickey')
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
      assert.strictEqual(response.body.id, origin + '/user/qc/publickey')
    })
    it('should return an object with an owner', async () => {
      assert.strictEqual(typeof response.body.owner, 'string')
    })
    it('should return an object with the bot as owner', async () => {
      assert.strictEqual(response.body.owner, origin + '/user/qc')
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
      assert.strictEqual(response.body.type, 'CryptographicKey')
    })
    it('should return an object with a to', async () => {
      assert.strictEqual(typeof response.body.to, 'string')
    })
    it('should return an object with a to matching the request', async () => {
      assert.strictEqual(response.body.to, 'as:Public')
    })
  })

  for (const coll of ['outbox', 'liked', 'followers', 'following']) {
    describe(`Province ${coll} collection`, async () => {
      describe(`GET /user/{botid}/${coll}`, async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/qc/${coll}`)
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
          assert.strictEqual(response.body.id, origin + `/user/qc/${coll}`)
        })
        it('should return an object with a type', async () => {
          assert.strictEqual(typeof response.body.type, 'string')
        })
        it('should return an object with a type matching the request', async () => {
          assert.strictEqual(response.body.type, 'OrderedCollection')
        })
        it('should return an object with a totalItems', async () => {
          assert.strictEqual(typeof response.body.totalItems, 'number')
        })
        it('should return an object with attributedTo', async () => {
          assert.strictEqual(typeof response.body.attributedTo, 'string')
        })
        it('should return an object with attributedTo matching the bot', async () => {
          assert.strictEqual(response.body.attributedTo, origin + '/user/qc')
        })
        it('should return an object with a to', async () => {
          assert.strictEqual(typeof response.body.to, 'string')
        })
        it('should return an object with a to for the public', async () => {
          assert.strictEqual(response.body.to, 'as:Public')
        })
        it('should return an object with a summary', async () => {
          assert.strictEqual(typeof response.body.summaryMap, 'object')
          assert.strictEqual(typeof response.body.summaryMap.en, 'string')
        })
        it('should return an object with a first', async () => {
          assert.strictEqual(typeof response.body.first, 'string')
        })
        it('should return an object with a last', async () => {
          assert.strictEqual(typeof response.body.last, 'string')
        })
        it(`should return an object with a ${coll}Of to the actor`, async () => {
          assert.strictEqual(typeof response.body[coll + 'Of'], 'string')
          assert.strictEqual(response.body[coll + 'Of'], origin + '/user/qc')
        })
      })
      describe(`GET /user/{botid}/${coll}/1`, async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/qc/${coll}/1`)
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
          assert.strictEqual(response.body.id, origin + `/user/qc/${coll}/1`)
        })
        it('should return an object with a type', async () => {
          assert.strictEqual(typeof response.body.type, 'string')
        })
        it('should return an object with a type matching the request', async () => {
          assert.strictEqual(response.body.type, 'OrderedCollectionPage')
        })
        it('should return an object with attributedTo', async () => {
          assert.strictEqual(typeof response.body.attributedTo, 'string')
        })
        it('should return an object with attributedTo matching the bot', async () => {
          assert.strictEqual(response.body.attributedTo, origin + '/user/qc')
        })
        it('should return an object with a to', async () => {
          assert.strictEqual(typeof response.body.to, 'string')
        })
        it('should return an object with a to for the public', async () => {
          assert.strictEqual(response.body.to, 'as:Public')
        })
        it('should return an object with a summary', async () => {
          assert.strictEqual(typeof response.body.summaryMap, 'object')
          assert.strictEqual(typeof response.body.summaryMap.en, 'string')
        })
        it('should return an object with a partOf', async () => {
          assert.strictEqual(typeof response.body.partOf, 'string')
        })
        it('should return an object with a partOf matching the collection', async () => {
          assert.strictEqual(response.body.partOf, origin + `/user/qc/${coll}`)
        })
      })
    })
  }

  describe('Province inbox collection', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/qc/inbox')
    })
    it('should return 403 Forbidden', async () => {
      assert.strictEqual(response.status, 403)
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
      assert.strictEqual(response.body.title, 'Forbidden')
    })
    it('should return an object with a status', async () => {
      assert.strictEqual(typeof response.body.status, 'number')
    })
    it('should return an object with a status matching the request', async () => {
      assert.strictEqual(response.body.status, 403)
    })
    it('should return an object with a detail', async () => {
      assert.strictEqual(typeof response.body.detail, 'string')
    })
    it('should return an object with a detail matching the request', async () => {
      assert.strictEqual(response.body.detail, 'No access to inbox collection')
    })
  })

  describe('Province inbox page', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/qc/inbox/1')
    })
    it('should return 403 Forbidden', async () => {
      assert.strictEqual(response.status, 403)
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
      assert.strictEqual(response.body.title, 'Forbidden')
    })
    it('should return an object with a status', async () => {
      assert.strictEqual(typeof response.body.status, 'number')
    })
    it('should return an object with a status matching the request', async () => {
      assert.strictEqual(response.body.status, 403)
    })
    it('should return an object with a detail', async () => {
      assert.strictEqual(typeof response.body.detail, 'string')
    })
    it('should return an object with a detail matching the request', async () => {
      assert.strictEqual(response.body.detail, 'No access to inbox collection')
    })
  })

  describe('Province inbox incoming activity', async () => {
    const username = 'actor1'
    const botName = 'qc'
    const path = `/user/${botName}/inbox`
    const url = `${origin}${path}`
    const date = new Date().toUTCString()
    const activity = await as2.import({
      type: 'Activity',
      actor: nockFormat({ username }),
      id: nockFormat({ username, type: 'activity', num: 1 })
    })
    const body = await activity.write()
    const digest = makeDigest(body)
    const signature = await nockSignature({
      method: 'POST',
      username,
      url,
      digest,
      date
    })
    let response = null
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
    it('should appear in the inbox', async () => {
      const { actorStorage } = app.locals
      assert.strictEqual(
        true,
        await actorStorage.isInCollection(
          botName,
          'inbox',
          activity
        )
      )
    })
  })
})
