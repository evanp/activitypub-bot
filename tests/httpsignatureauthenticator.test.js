import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'
import { KeyStorage } from '../lib/keystorage.js'
import { nockSetup, nockSignature, nockKeyRotate, nockFormat } from '@evanp/activitypub-nock'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPSignatureAuthenticator } from '../lib/httpsignatureauthenticator.js'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'
import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from '../lib/activitystreams.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('HTTPSignatureAuthenticator', async () => {
  const LOCAL_HOST = 'local.httpsignatureauthenticator.test'
  const REMOTE_HOST = 'social.httpsignatureauthenticator.test'
  const origin = `https://${LOCAL_HOST}`
  const LOCAL_USER = 'httpsignatureauthtestlocal'
  const REMOTE_USER_1 = 'httpsignatureauthremote1'
  const REMOTE_USER_2 = 'httpsignatureauthremote2'
  const REMOTE_USER_3 = 'httpsignatureauthremote3'
  const TEST_USERNAMES = [LOCAL_USER]
  const OUTBOX_PATH = `/user/${LOCAL_USER}/outbox`
  const OUTBOX_URL = `${origin}${OUTBOX_PATH}`
  const INBOX_PATH = `/user/${LOCAL_USER}/inbox`

  function nockSignatureDefault (params) {
    return nockSignature({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  function nockFormatDefault (params) {
    return nockFormat({ ...params, domain: params.domain ?? REMOTE_HOST })
  }

  function nockKeyRotateDefault (username, domain = REMOTE_HOST) {
    return nockKeyRotate(username, domain)
  }

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
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    signer = new HTTPSignature(logger)
    digester = new Digester(logger)
    const formatter = new UrlFormatter(origin)
    const keyStorage = new KeyStorage(connection, logger)
    const client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    remoteKeyStorage = new RemoteKeyStorage(client, connection, logger)
    nockSetup(REMOTE_HOST)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
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
    const username = REMOTE_USER_1
    const date = new Date().toUTCString()
    const signature = await nockSignatureDefault({
      url: OUTBOX_URL,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can authenticate a valid GET request with parameters', async () => {
    const lname = LOCAL_USER
    const username = REMOTE_USER_1
    const date = new Date().toUTCString()
    const signature = await nockSignatureDefault({
      url: `${origin}/.well-known/webfinger?resource=acct:${lname}@${LOCAL_HOST}`,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = `/.well-known/webfinger?resource=acct:${lname}@${LOCAL_HOST}`
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can authenticate a valid GET request after key rotation', async () => {
    const username = REMOTE_USER_2
    const date = new Date().toUTCString()
    const signature = await nockSignatureDefault({
      url: OUTBOX_URL,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
    await nockKeyRotateDefault(username)
    const date2 = new Date().toUTCString()
    const signature2 = await nockSignatureDefault({
      url: OUTBOX_URL,
      date: date2,
      username
    })
    const headers2 = {
      date: date2,
      signature: signature2,
      host: URL.parse(origin).host
    }
    const req2 = {
      headers: headers2,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req2, res, next)
  })

  it('can authenticate a valid POST request', async () => {
    const username = REMOTE_USER_3
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormatDefault({ username, type }),
      type
    })
    const rawBodyText = await activity.write()
    const digest = await digester.digest(rawBodyText)
    const date = new Date().toUTCString()
    const method = 'POST'
    const originalUrl = INBOX_PATH
    const signature = await nockSignatureDefault({
      username,
      url: `${origin}${originalUrl}`,
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
      originalUrl,
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
    const originalUrl = OUTBOX_PATH
    const headers = {
      date,
      host: URL.parse(origin).host
    }
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can refuse a request signed with the wrong key', async () => {
    const username = REMOTE_USER_1
    const date = new Date().toUTCString()
    const signature = await nockSignatureDefault({
      url: OUTBOX_URL,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can refuse a request with a bad digest', async () => {
    const username = REMOTE_USER_3
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormatDefault({ username, type }),
      type
    })
    const rawBodyText = await activity.write()
    const digest = await digester.digest('This does not match the rawBodyText')
    const date = new Date().toUTCString()
    const method = 'POST'
    const originalUrl = INBOX_PATH
    const signature = await nockSignatureDefault({
      username,
      url: `${origin}${originalUrl}`,
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
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a missing digest', async () => {
    const username = REMOTE_USER_3
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormatDefault({ username, type }),
      type
    })
    const rawBodyText = await activity.write()
    const date = new Date().toUTCString()
    const method = 'POST'
    const originalUrl = INBOX_PATH
    const signature = await nockSignatureDefault({
      username,
      url: `${origin}${originalUrl}`,
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
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a missing date', async () => {
    const username = REMOTE_USER_1
    const date = new Date().toUTCString()
    const signature = await nockSignatureDefault({
      url: OUTBOX_URL,
      date,
      username
    })
    const headers = {
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a badly formatted date', async () => {
    const username = REMOTE_USER_1
    const date = '3 Prairial CCXXXIII 14:00:35'
    const signature = await nockSignatureDefault({
      url: OUTBOX_URL,
      date,
      username
    })
    const headers = {
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a past date outside of the skew window', async () => {
    const username = REMOTE_USER_1
    // 10 days ago
    const date = (new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)).toUTCString()
    logger.debug(date)
    const signature = await nockSignatureDefault({
      url: OUTBOX_URL,
      date,
      username
    })
    const headers = {
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('can refuse a request with a future date outside of the skew window', async () => {
    const username = REMOTE_USER_1
    // 10 days ago
    const date = (new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)).toUTCString()
    logger.debug(date)
    const signature = await nockSignatureDefault({
      url: OUTBOX_URL,
      date,
      username
    })
    const headers = {
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {

    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      }
    }
    await authenticator.authenticate(req, res, failNext)
  })
})
