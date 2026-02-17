import { describe, before, after, it } from 'node:test'
import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import assert from 'node:assert'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { nockSetup, nockFormat, getPublicKey, nockKeyRotate } from '@evanp/activitypub-nock'
import { HTTPSignature } from '../lib/httpsignature.js'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const LOCAL_HOST = 'local.remotekeystorage.test'
const REMOTE_HOST = 'remote.remotekeystorage.test'
const REMOTE_USER_1 = 'remotekeystoragetest1'
const REMOTE_USER_2 = 'remotekeystoragetest2'
const REMOTE_USER_3 = 'remotekeystoragetest3'

describe('RemoteKeyStorage', async () => {
  const origin = `https://${LOCAL_HOST}`
  let connection = null
  let remoteKeyStorage = null
  let client = null
  let logger = null

  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    const keyStorage = new KeyStorage(connection, logger)
    const formatter = new UrlFormatter(origin)
    const digester = new Digester(logger)
    const signer = new HTTPSignature(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    nockSetup(REMOTE_HOST)
  })

  after(async () => {
    await cleanupTestData(connection, {
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await connection.close()
    connection = null
    remoteKeyStorage = null
    client = null
    logger = null
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
})
