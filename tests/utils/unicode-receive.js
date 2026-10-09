import assert from 'node:assert'
import crypto from 'node:crypto'
import nock from 'nock'
import request from 'supertest'
import { getPublicKey, nockMessageSignature } from '@evanp/activitypub-nock'

import as2 from '../../lib/activitystreams.js'

export async function receiveUnicodeActivity (app, { username, domain, path, botName, origin }) {
  const remoteOrigin = new URL(`https://${domain}`).origin
  const actorId = new URL(`/user/${encodeURIComponent(username)}`, remoteOrigin).href
  const keyId = `${actorId}/publickey`
  const publicKey = {
    id: keyId,
    owner: actorId,
    publicKeyPem: await getPublicKey(username, domain)
  }
  nock(remoteOrigin)
    .persist()
    .get(new URL(actorId).pathname)
    .reply(200, {
      '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
      id: actorId,
      type: 'Person',
      preferredUsername: username,
      inbox: `${actorId}/inbox`,
      publicKey
    }, { 'Content-Type': 'application/activity+json' })
    .get(new URL(keyId).pathname)
    .reply(200, {
      '@context': 'https://w3id.org/security/v1',
      type: 'CryptographicKey',
      ...publicKey
    }, { 'Content-Type': 'application/activity+json' })

  const activity = await as2.import({
    type: 'Activity',
    id: `${actorId}/activity/unicode-receive`,
    actor: actorId,
    to: app.locals.formatter.format({ username: botName })
  })
  const body = await activity.write()
  const contentDigest = `sha-256=:${crypto.createHash('sha256').update(body).digest('base64')}:`
  const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
    method: 'POST',
    url: `${origin}${path}`,
    contentDigest,
    username,
    domain,
    keyId
  })
  const response = await request(app)
    .post(path)
    .send(body)
    .set('Signature-Input', signatureInput)
    .set('Signature', signature)
    .set('Host', new URL(origin).host)
    .set('Content-Digest', contentDigest)
    .set('Content-Type', 'application/activity+json')

  assert.strictEqual(response.status, 202, JSON.stringify(response.body))
  await app.onIdle()
  assert.strictEqual(await app.locals.actorStorage.isInCollection(botName, 'inbox', activity), true)
}
