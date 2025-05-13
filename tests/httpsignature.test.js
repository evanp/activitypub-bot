import { describe, before, after, it } from 'node:test'
import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { nockSetup, nockSignature } from './utils/nock.js'
import { HTTPSignature } from '../lib/httpsignature.js'

describe('HTTPSignature', async () => {
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

  it('can validate a signature with a different host', async () => {
    const signature = 'keyId="https://onepage.pub/key/tUSax4RKetiJX0Oi6DPUs",headers="(request-target) host date",signature="ZXOri78axmjmw3nflTnX2hdz0D5J17mcEYmxC/LSp99cmOs9KvMkyZeZ8JxfkGXeGfZqDw0uwsqjLePZ9Udo5P1sD/pJOZl7x0Ok0au5nDVWhiJDTXOplhsg2TE8HlYP8ClXx1g6JrOZSGlUUBlLqVDglQf6wP+QiAzypuYl59YxewADQc3S3NQzBfAAVmb8q5IqphQ5xoiuDOP41X6Ejs1sPp+CQH6J/zrLfIslBnzfBIlEh6oOdGKaRC3kI7gnJIn74aHlgXi0hP7bPXp/U6lx1XypZ2KcWprNdtgcV6cFMawxyGjfKfKYxGJqwspENGydmJlvlH+3veUmBm3i2A==",algorithm="rsa-sha256"'

    const owner = await httpSignature.validate(
      signature,
      'GET',
      '/user/ok',
      {
        date: '2025-05-13T13:15:19.056Z',
        signature,
        host: 'activitypub.bot'
      }
    )
    assert.strictEqual(owner, 'https://onepage.pub/person/OpgJTNDppzYIDfl94BrAW')
  })
})
