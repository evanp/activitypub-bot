import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import crypto from 'node:crypto'
import nock from 'nock'
import request from 'supertest'
import { getPublicKey, nockMessageSignature } from '@evanp/activitypub-nock'

import as2 from '../lib/activitystreams.js'
import { makeApp } from '../lib/app.js'
import OKBot from '../lib/bots/ok.js'
import { cleanupTestData, getTestDatabaseUrl, getTestRedisUrl, cleanupRedis } from './utils/db.js'

describe('OKBot replies to Unicode handles', () => {
  const origin = 'https://local.okbot-unicode.test'
  const botName = 'okbotunicodetest'
  const botId = `${origin}/user/${botName}`
  const remoteDomains = ['remote.okbot-unicode.test', 'xn--caf-dma.okbot-unicode.test']
  let app

  before(async () => {
    await cleanupRedis(origin)
    app = await makeApp({
      origin,
      databaseUrl: getTestDatabaseUrl(),
      redisUrl: getTestRedisUrl(),
      bots: { [botName]: new OKBot(botName) },
      logLevel: 'silent'
    })
    await cleanupTestData(app.locals.connection, {
      usernames: [botName], localDomain: new URL(origin).host, remoteDomains
    })
  })

  after(async () => {
    await cleanupRedis(origin)
    if (app) {
      await cleanupTestData(app.locals.connection, {
        usernames: [botName], localDomain: new URL(origin).host, remoteDomains
      })
      await app.cleanup()
    }
    nock.cleanAll()
  })

  for (const { label, username, domain, resource } of [
    { label: 'non-ASCII username', username: 'zoë', domain: 'remote.okbot-unicode.test', resource: 'acct:zo%C3%AB@remote.okbot-unicode.test' },
    { label: 'non-ASCII domain', username: 'user', domain: 'café.okbot-unicode.test', resource: 'acct:user@xn--caf-dma.okbot-unicode.test' },
    { label: 'non-ASCII username and domain', username: 'zoë', domain: 'café.okbot-unicode.test', resource: 'acct:zo%C3%AB@xn--caf-dma.okbot-unicode.test' }
  ]) {
    it(`delivers a reply with a linked mention for a ${label}`, async () => {
      const remoteOrigin = new URL(`https://${domain}`).origin
      const actorId = `${remoteOrigin}/user/${encodeURIComponent(username)}`
      const profileUrl = `${remoteOrigin}/profile/${encodeURIComponent(username)}`
      const keyId = `${actorId}/publickey`
      const noteId = `${actorId}/note/1`
      const actor = {
        '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
        id: actorId,
        type: 'Person',
        preferredUsername: username,
        url: profileUrl,
        inbox: `${actorId}/inbox`,
        publicKey: { id: keyId, owner: actorId, publicKeyPem: await getPublicKey(username, domain) }
      }
      const note = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: noteId,
        type: 'Note',
        attributedTo: actorId,
        to: botId,
        content: `Hello @${botName}`,
        tag: [{ type: 'Mention', name: `@${botName}`, href: botId }]
      }
      nock(remoteOrigin)
        .persist()
        .get(new URL(actorId).pathname)
        .reply(200, actor, { 'Content-Type': 'application/activity+json' })
        .get(new URL(keyId).pathname)
        .reply(200, { '@context': 'https://w3id.org/security/v1', type: 'CryptographicKey', ...actor.publicKey }, { 'Content-Type': 'application/activity+json' })
        .get(new URL(noteId).pathname)
        .reply(200, note, { 'Content-Type': 'application/activity+json' })
      const discovery = nock(remoteOrigin)
        .get('/.well-known/webfinger')
        .query({ resource })
        .reply(200, { subject: resource, links: [{ rel: 'self', type: 'application/activity+json', href: actorId }] }, { 'Content-Type': 'application/jrd+json' })
      let delivered
      const inbox = nock(remoteOrigin)
        .post(new URL(`${actorId}/inbox`).pathname)
        .reply(202, (uri, body) => {
          delivered = typeof body === 'string' ? JSON.parse(body) : body
          return ''
        })
      const activity = await as2.import({
        type: 'Create', id: `${actorId}/create/1`, actor: actorId, to: botId, object: note
      })
      const body = await activity.write()
      const contentDigest = `sha-256=:${crypto.createHash('sha256').update(body).digest('base64')}:`
      const path = `/user/${botName}/inbox`
      const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
        method: 'POST', url: `${origin}${path}`, contentDigest, username, domain, keyId
      })
      const response = await request(app)
        .post(path)
        .send(body)
        .set('Host', new URL(origin).host)
        .set('Signature-Input', signatureInput)
        .set('Signature', signature)
        .set('Content-Digest', contentDigest)
        .set('Content-Type', 'application/activity+json')

      assert.strictEqual(response.status, 202, JSON.stringify(response.body))
      await app.onIdle()
      assert.ok(inbox.isDone(), 'OKBot reply should reach the remote inbox')
      assert.ok(discovery.isDone(), 'reply mention should use forward discovery')
      const replyActivity = await as2.import(delivered)
      assert.strictEqual(replyActivity.type, 'https://www.w3.org/ns/activitystreams#Create')
      assert.strictEqual(replyActivity.actor.first.id, botId)
      const reply = await app.locals.objectStorage.read(replyActivity.object.first.id)
      assert.strictEqual(reply.type, 'https://www.w3.org/ns/activitystreams#Note')
      assert.strictEqual(reply.attributedTo.first.id, botId)
      assert.strictEqual(reply.inReplyTo.first.id, noteId)
      assert.ok(Array.from(reply.to).some(recipient => recipient.id === actorId))
      assert.strictEqual(reply.content.get(), `<p><a href="${profileUrl}">@${username}@${domain}</a> OK</p>`)
      assert.strictEqual(reply.tag.length, 1)
      assert.strictEqual(reply.tag.first.type, 'https://www.w3.org/ns/activitystreams#Mention')
      assert.strictEqual(reply.tag.first.name.get(), `@${username}@${domain}`)
      assert.strictEqual(reply.tag.first.href, profileUrl)
    })
  }
})
