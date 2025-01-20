import { describe, before, after, it } from 'node:test'
import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { nockSetup, nockSignature } from './utils/nock.js'
import { HTTPSignature } from '../lib/httpsignature.js'

describe('RemoteKeyStorage', async () => {
  const origin = 'https://activitypubbot.example'
  let connection = null
  let remoteKeyStorage = null
  let client = null
  let httpSignature = null

  before(async () => {
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    const keyStorage = new KeyStorage(connection)
    await keyStorage.initialize()
    const formatter = new UrlFormatter(origin)
    client = new ActivityPubClient(keyStorage, formatter)
    remoteKeyStorage = new RemoteKeyStorage(client, connection)
    await remoteKeyStorage.initialize()
    nockSetup('social.example')
  })

  after(async () => {
    await connection.close()
  })

  it('can initialize', async () => {
    httpSignature = new HTTPSignature(remoteKeyStorage)
    assert.ok(httpSignature)
  })

  it('can validate a signature', async () => {
    const username = 'test'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const owner = await httpSignature.validate(
      signature,
      'GET',
      '/user/ok/outbox',
      {
        date,
        signature,
        host: 'activitypubbot.example'
      }
    )
    assert.strictEqual(owner, `https://social.example/user/${username}`)
  })
})
