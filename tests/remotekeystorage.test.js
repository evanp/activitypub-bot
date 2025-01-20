import { describe, before, after, it } from 'node:test'
import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { nockSetup, nockFormat, getPublicKey } from './utils/nock.js'

describe('RemoteKeyStorage', async () => {
  const origin = 'https://activitypubbot.example'
  let connection = null
  let remoteKeyStorage = null
  let client = null

  before(async () => {
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    const keyStorage = new KeyStorage(connection)
    await keyStorage.initialize()
    const formatter = new UrlFormatter(origin)
    client = new ActivityPubClient(keyStorage, formatter)
    nockSetup('social.example')
  })

  after(async () => {
    await connection.close()
  })

  it('can initialize', async () => {
    remoteKeyStorage = new RemoteKeyStorage(client, connection)
    assert.ok(remoteKeyStorage)
    await remoteKeyStorage.initialize()
    assert.ok(true)
  })

  it('can get a remote public key', async () => {
    const username = 'test'
    const domain = 'social.example'
    const id = nockFormat({ username, key: true, domain })
    const publicKey = await getPublicKey(username, domain)
    const remote = await remoteKeyStorage.getPublicKey(id)
    assert.equal(remote.publicKeyPem, publicKey)
  })

  it('can get the same remote public key twice', async () => {
    const username = 'test'
    const domain = 'social.example'
    const id = nockFormat({ username, key: true, domain })
    const publicKey = await getPublicKey(username, domain)
    const remote = await remoteKeyStorage.getPublicKey(id)
    assert.equal(remote.publicKeyPem, publicKey)
  })
})
