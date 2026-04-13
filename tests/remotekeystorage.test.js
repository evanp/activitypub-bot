import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import nock from 'nock'
import { nockSetup, nockFormat, getPublicKey, nockKeyRotate } from '@evanp/activitypub-nock'

import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { SafeAgent } from '../lib/safeagent.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'
import { RequestThrottler } from '../lib/requestthrottler.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const LOCAL_HOST = 'local.remotekeystorage.test'
const REMOTE_HOST = 'remote.remotekeystorage.test'
const REMOTE_USER_1 = 'remotekeystoragetest1'
const REMOTE_USER_2 = 'remotekeystoragetest2'
const REMOTE_USER_3 = 'remotekeystoragetest3'
const MISMATCH_HOST = 'mismatch.remotekeystorage.test'
const MISMATCH_USER = 'remotekeystoragemismatch1'
const NOSEC_HOST = 'nosec.remotekeystorage.test'
const NOSEC_USER = 'remotekeystoragenosec1'
const DUPLICATE_KEY_HOST = 'duplicatekey.remotekeystorage.test'
const DUPLICATE_KEY_USER = 'remotekeystoragedupkey1'

describe('RemoteKeyStorage', async () => {
  const origin = `https://${LOCAL_HOST}`
  let connection = null
  let remoteKeyStorage = null
  let client = null
  let logger = null
  let throttler

  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, MISMATCH_HOST, NOSEC_HOST, DUPLICATE_KEY_HOST]
    })
    const keyStorage = new KeyStorage(connection, logger)
    const formatter = new UrlFormatter(origin)
    const digester = new Digester(logger)
    const signer = new HTTPSignature(logger)
    const messageSigner = new HTTPMessageSignature(logger)
    throttler = new RequestThrottler(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    const policyStorage = new SignaturePolicyStorage(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, throttler, remoteObjectCache, messageSigner, policyStorage, new SafeAgent())
    nockSetup(REMOTE_HOST)
  })

  after(async () => {
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, MISMATCH_HOST, NOSEC_HOST, DUPLICATE_KEY_HOST]
    })
    await connection.close()
  })

  it('can initialize', async () => {
    remoteKeyStorage = new RemoteKeyStorage(client, connection, logger)
    assert.ok(remoteKeyStorage)
    assert.ok(true)
  })

  it('can get a remote public key', async () => {
    const username = REMOTE_USER_1
    const domain = REMOTE_HOST
    const id = nockFormat({ username, key: true, domain })
    const publicKey = await getPublicKey(username, domain)
    const remote = await remoteKeyStorage.getPublicKey(id)
    assert.equal(remote.publicKeyPem, publicKey)
  })

  it('can get the same remote public key twice', async () => {
    const username = REMOTE_USER_2
    const domain = REMOTE_HOST
    const id = nockFormat({ username, key: true, domain })
    const publicKey = await getPublicKey(username, domain)
    const remote = await remoteKeyStorage.getPublicKey(id)
    assert.equal(remote.publicKeyPem, publicKey)
  })

  it('can get the right public key after key rotation', async () => {
    const username = REMOTE_USER_3
    const domain = REMOTE_HOST
    const id = nockFormat({ username, key: true, domain })
    const publicKey = await getPublicKey(username, domain)
    const remote = await remoteKeyStorage.getPublicKey(id)
    assert.equal(remote.publicKeyPem, publicKey)
    await nockKeyRotate(username, domain)
    const publicKey2 = await getPublicKey(username, domain)
    const remote2 = await remoteKeyStorage.getPublicKey(id, false)
    assert.equal(remote2.publicKeyPem, publicKey2)
  })

  it('returns null when owner actor publicKey does not match key id', async () => {
    const domain = MISMATCH_HOST
    const username = MISMATCH_USER
    const keyId = `https://${domain}/user/${username}/publickey`
    const actorId = `https://${domain}/user/${username}`
    const otherKeyId = `https://${domain}/user/${username}/otherkey`
    const publicKeyPem = await getPublicKey(REMOTE_USER_1, REMOTE_HOST)

    nock(`https://${domain}`)
      .get(`/user/${username}/publickey`)
      .reply(200, JSON.stringify({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1'
        ],
        id: keyId,
        type: 'CryptographicKey',
        owner: actorId,
        publicKeyPem
      }), { 'Content-Type': 'application/activity+json' })
      .get(`/user/${username}`)
      .reply(200, JSON.stringify({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1'
        ],
        id: actorId,
        type: 'Person',
        publicKey: {
          id: otherKeyId,
          type: 'CryptographicKey',
          owner: actorId,
          publicKeyPem
        }
      }), { 'Content-Type': 'application/activity+json' })

    const result = await remoteKeyStorage.getPublicKey(keyId)
    assert.equal(result, null)
  })

  it('can get a remote public key when actor omits security context', async () => {
    const domain = NOSEC_HOST
    const username = NOSEC_USER
    const keyId = `https://${domain}/user/${username}/publickey`
    const actorId = `https://${domain}/user/${username}`
    const publicKeyPem = await getPublicKey(REMOTE_USER_1, REMOTE_HOST)

    nock(`https://${domain}`)
      .get(`/user/${username}/publickey`)
      .reply(200, JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: keyId,
        type: 'CryptographicKey',
        owner: actorId,
        publicKeyPem
      }), { 'Content-Type': 'application/activity+json' })
      .get(`/user/${username}`)
      .reply(200, JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: actorId,
        type: 'Person',
        publicKey: {
          id: keyId,
          type: 'CryptographicKey',
          owner: actorId,
          publicKeyPem
        }
      }), { 'Content-Type': 'application/activity+json' })

    const remote = await remoteKeyStorage.getPublicKey(keyId)
    assert.ok(remote)
    assert.equal(remote.publicKeyPem, publicKeyPem)
    assert.equal(remote.owner, actorId)
  })

  it('can get a public key when actor has duplicate key ID in publicKey and assertionMethod', async () => {
    const domain = DUPLICATE_KEY_HOST
    const username = DUPLICATE_KEY_USER
    const actorId = `https://${domain}/user/${username}`
    const keyId = `${actorId}#main-key`
    const publicKeyPem = await getPublicKey(REMOTE_USER_1, REMOTE_HOST)

    const actorJson = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
        {
          assertionMethod: {
            '@id': 'https://w3id.org/security#assertionMethod',
            '@type': '@id',
            '@container': '@set'
          },
          Multikey: 'https://w3id.org/security#Multikey',
          controller: {
            '@id': 'https://w3id.org/security#controller',
            '@type': '@id'
          },
          publicKeyMultibase: 'https://w3id.org/security#publicKeyMultibase'
        }
      ],
      id: actorId,
      type: 'Person',
      assertionMethod: [
        {
          id: keyId,
          type: 'Multikey',
          controller: actorId,
          publicKeyMultibase: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
        }
      ],
      publicKey: {
        id: keyId,
        type: 'CryptographicKey',
        owner: actorId,
        publicKeyPem
      }
    }

    nock(`https://${domain}`)
      .get(`/user/${username}`)
      .twice()
      .reply(200, JSON.stringify(actorJson), { 'Content-Type': 'application/activity+json' })

    const remote = await remoteKeyStorage.getPublicKey(keyId)
    assert.ok(remote)
    assert.equal(remote.publicKeyPem, publicKeyPem)
    assert.equal(remote.owner, actorId)
  })
})
