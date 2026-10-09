import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import request from 'supertest'
import { nockSetup, nockSignature, nockFormat, getBody } from '@evanp/activitypub-nock'

import as2 from '../lib/activitystreams.js'
import { makeApp } from '../lib/app.js'
import OKBot from '../lib/bots/ok.js'
import { makeDigest } from './utils/digest.js'
import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

describe('server on a Unicode domain', () => {
  const domain = 'café.routes-domain.test'
  const origin = `https://${domain}`
  const asciiOrigin = new URL(origin).origin
  const botName = 'unicodedomainokbot'
  const actorId = `${asciiOrigin}/user/${botName}`
  const remoteDomain = 'remote.routes-domain.test'
  const remoteUsername = 'sender'
  const remoteActorId = nockFormat({ username: remoteUsername, domain: remoteDomain })
  let app
  let createId
  let note

  before(async () => {
    nockSetup(remoteDomain)
    await cleanupRedis(origin)
    app = await makeApp({
      origin,
      databaseUrl: getTestDatabaseUrl(),
      redisUrl: getTestRedisUrl(),
      bots: { [botName]: new OKBot(botName) },
      logLevel: 'silent'
    })
    await cleanupTestData(app.locals.connection, {
      usernames: [botName],
      localDomain: domain,
      remoteDomains: [remoteDomain, new URL(origin).hostname]
    })
  })

  after(async () => {
    await cleanupRedis(origin)
    if (app) {
      await cleanupTestData(app.locals.connection, {
        usernames: [botName],
        localDomain: domain,
        remoteDomains: [remoteDomain, new URL(origin).hostname]
      })
      await app.cleanup()
    }
  })

  it('serves WebFinger with the correct subject and actor link', async () => {
    const resource = `acct:${botName}@${new URL(origin).hostname}`
    const response = await request(app)
      .get('/.well-known/webfinger')
      .query({ resource })
      .set('Host', new URL(origin).host)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(response.body.subject, `acct:${botName}@${new URL(origin).hostname}`)
    assert.strictEqual(response.body.links.find(link => link.rel === 'self').href, actorId)
  })

  for (const collection of [null, 'followers', 'following', 'liked']) {
    it(`serves GET ${collection || 'actor'} with the correct id`, async () => {
      const id = collection ? `${actorId}/${collection}` : actorId
      const response = await request(app)
        .get(new URL(id).pathname)
        .set('Host', new URL(origin).host)
        .set('Accept', 'application/activity+json')
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.body.id, id)
    })
  }

  it('accepts a mention in POST inbox and creates an OKBot reply', async () => {
    const path = `/user/${botName}/inbox`
    const incoming = await as2.import({
      type: 'Create',
      id: `${remoteActorId}/create/domain-test`,
      actor: remoteActorId,
      to: actorId,
      cc: 'as:Public',
      object: {
        type: 'Note',
        id: `${remoteActorId}/note/domain-test`,
        attributedTo: remoteActorId,
        to: actorId,
        cc: 'as:Public',
        content: 'Hello',
        tag: [{ type: 'Mention', name: `@${botName}@${domain}`, href: actorId }]
      }
    })
    const body = await incoming.write()
    const digest = makeDigest(body)
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      method: 'POST',
      url: `${asciiOrigin}${path}`,
      date,
      digest,
      username: remoteUsername,
      domain: remoteDomain
    })
    const response = await request(app)
      .post(path).send(body)
      .set('Host', new URL(origin).host)
      .set('Signature', signature).set('Date', date).set('Digest', digest)
      .set('Content-Type', 'application/activity+json')
    assert.strictEqual(response.status, 202, JSON.stringify(response.body))
    await app.onIdle()
    const delivered = getBody(`${remoteActorId}/inbox`)
    assert.ok(delivered, 'OKBot reply should reach the remote inbox')
    const create = await as2.import(typeof delivered === 'string' ? JSON.parse(delivered) : delivered)
    createId = create.id
    note = await app.locals.objectStorage.read(create.object.first.id)
    assert.strictEqual(create.actor.first.id, actorId)
    assert.strictEqual(note.inReplyTo.first.id, `${remoteActorId}/note/domain-test`)
  })

  it('serves GET outbox with the correct id', async () => {
    const response = await request(app)
      .get(`/user/${botName}/outbox`)
      .set('Host', new URL(origin).host)
      .set('Accept', 'application/activity+json')
    assert.strictEqual(response.status, 200)
    assert.strictEqual(response.body.id, `${actorId}/outbox`)
  })

  for (const resource of ['Create', 'Note', 'replies', 'shares', 'likes']) {
    it(`serves GET ${resource} with the correct id`, async () => {
      assert.ok(createId && note, 'POST inbox must generate the reply resources')
      const id = resource === 'Create'
        ? createId
        : resource === 'Note' ? note.id : note.get(resource).first.id
      assert.strictEqual(new URL(id).origin, asciiOrigin)
      assert.ok(id.startsWith(`${actorId}/`), 'resource id should use the ASCII domain')
      const response = await request(app)
        .get(new URL(id).pathname)
        .set('Host', new URL(origin).host)
        .set('Accept', 'application/activity+json')
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.body.id, id)
    })
  }
})
