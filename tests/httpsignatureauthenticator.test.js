import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import { KeyStorage } from '../lib/keystorage.js'
import { nockSetup, nockSignature, nockKeyRotate, nockFormat } from './utils/nock.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPSignatureAuthenticator } from '../lib/httpsignatureauthenticator.js'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'
import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from 'activitystrea.ms'

describe('HTTPSignatureAuthenticator', async () => {
  const origin = 'https://activitypubbot.example'
  let authenticator = null
  let logger = null
  let signer = null
  let digester = null
  let remoteKeyStorage = null
  let connection = null
  const next = (err) => {
    if (err) {
      assert.fail(`Failed to authenticate: ${err.message}`)
    } else {
      assert.ok(true, 'Authenticated successfully')
    }
  }
  const failNext = (err) => {
    if (err) {
      assert.ok(true, 'Failed successfully')
    } else {
      assert.fail('Passed through an incorrect request')
    }
  }
  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    signer = new HTTPSignature(logger)
    digester = new Digester(logger)
    const formatter = new UrlFormatter(origin)
    const keyStorage = new KeyStorage(connection, logger)
    await keyStorage.initialize()
    const client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    remoteKeyStorage = new RemoteKeyStorage(client, connection, logger)
    await remoteKeyStorage.initialize()
    nockSetup('social.example')
  })

  after(async () => {
    await connection.close()
    authenticator = null
    digester = null
    signer = null
    remoteKeyStorage = null
  })

  it('can initialize', async () => {
    authenticator = new HTTPSignatureAuthenticator(
      remoteKeyStorage,
      signer,
      digester,
      logger)
  })

  it('can authenticate a valid GET request', async () => {
    const username = 'test'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const path = '/user/ok/outbox'
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can authenticate a valid GET request after key rotation', async () => {
    const username = 'test2'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const path = '/user/ok/outbox'
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
    await nockKeyRotate(username)
    const date2 = new Date().toUTCString()
    const signature2 = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date2,
      username
    })
    const headers2 = {
      date: date2,
      signature: signature2,
      host: URL.parse(origin).host
    }
    const req2 = {
      headers: headers2,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req2, res, next)
  })

  it('can authenticate a valid POST request', async () => {
    const username = 'test3'
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormat({ username, type }),
      type
    })
    const rawBodyText = await activity.write()
    const digest = await digester.digest(rawBodyText)
    const date = new Date().toUTCString()
    const method = 'POST'
    const path = '/user/ok/inbox'
    const signature = await nockSignature({
      username,
      url: `${origin}${path}`,
      date,
      digest,
      method
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host,
      digest
    }
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText
    }
    await authenticator.authenticate(req, res, next)
  })

  it('skips a request that is not signed', async () => {
    const date = new Date().toUTCString()
    const method = 'GET'
    const path = '/user/ok/outbox'
    const headers = {
      date,
      host: URL.parse(origin).host
    }
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can refuse a request signed with the wrong key', async () => {
    const username = 'test'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const path = '/user/ok/outbox'
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can refuse a request with a bad digest', async () => {
    const username = 'test3'
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormat({ username, type }),
      type
    })
    const rawBodyText = await activity.write()
    const digest = await digester.digest('This does not match the rawBodyText')
    const date = new Date().toUTCString()
    const method = 'POST'
    const path = '/user/ok/inbox'
    const signature = await nockSignature({
      username,
      url: `${origin}${path}`,
      date,
      digest,
      method
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host,
      digest
    }
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a missing digest', async () => {
    const username = 'test3'
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormat({ username, type }),
      type
    })
    const rawBodyText = await activity.write()
    const date = new Date().toUTCString()
    const method = 'POST'
    const path = '/user/ok/inbox'
    const signature = await nockSignature({
      username,
      url: `${origin}${path}`,
      date,
      method
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a missing date', async () => {
    const username = 'test'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const path = '/user/ok/outbox'
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a badly formatted date', async () => {
    const username = 'test'
    const date = '3 Prairial CCXXXIII 14:00:35'
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const path = '/user/ok/outbox'
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a date outside of the skew window', async () => {
    const username = 'test'
    // 10 days ago
    const date = (new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)).toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const path = '/user/ok/outbox'
    const res = {

    }
    const req = {
      headers,
      path,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, failNext)
  })
})
