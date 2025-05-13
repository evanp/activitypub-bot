import { describe, it } from 'node:test'
import assert from 'node:assert'
import { makeApp } from '../lib/app.js'
import request from 'supertest'
import bots from './fixtures/bots.js'

describe('actor collection routes', async () => {
  const databaseUrl = 'sqlite::memory:'
  const origin = 'https://activitypubbot.test'
  const app = await makeApp(databaseUrl, origin, bots, 'silent')

  for (const coll of ['outbox', 'liked', 'followers', 'following']) {
    describe(`${coll} collection`, async () => {
      describe(`GET /user/{botid}/${coll}`, async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/ok/${coll}`)
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
          assert.strictEqual(response.body.id, origin + `/user/ok/${coll}`)
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
          assert.strictEqual(response.body.attributedTo, origin + '/user/ok')
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
      })
      describe('GET collection for non-existent user', async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get('/user/dne/' + coll)
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
      describe(`GET /user/{botid}/${coll}/1`, async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get(`/user/ok/${coll}/1`)
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
          assert.strictEqual(response.body.id, origin + `/user/ok/${coll}/1`)
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
          assert.strictEqual(response.body.attributedTo, origin + '/user/ok')
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
          assert.strictEqual(response.body.partOf, origin + `/user/ok/${coll}`)
        })
      })
      describe('GET collection page for non-existent user', async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get('/user/dne/' + coll + '/1')
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
      describe('GET non-existent page for existent collection and existent user', async () => {
        let response = null
        it('should work without an error', async () => {
          response = await request(app).get('/user/ok/' + coll + '/99999999')
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
          assert.strictEqual(response.body.detail, 'No such page 99999999 for collection ' + coll + ' for user ok')
        })
      })
    })
  }

  describe('GET non-existent collection for existent user', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/ok/dne')
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
      assert.strictEqual(response.body.detail, 'No such collection dne for user ok')
    })
  })

  describe('GET page for non-existent collection for existent user', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/ok/dne/1')
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
      assert.strictEqual(response.body.detail, 'No such collection dne for user ok')
    })
  })

  describe('GET /user/{botid}/inbox', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/ok/inbox')
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

  describe('GET /user/{botid}/inbox/1', async () => {
    let response = null
    it('should work without an error', async () => {
      response = await request(app).get('/user/ok/inbox/1')
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
})
