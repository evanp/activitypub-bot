import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import { nockSetup, nockSignature, nockKeyRotate, nockFormat, nockMessageSignature } from '@evanp/activitypub-nock'
import crypto from 'node:crypto'
import Logger from 'pino'

import { KeyStorage } from '../lib/keystorage.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { HTTPSignatureAuthenticator } from '../lib/httpsignatureauthenticator.js'
import { Digester } from '../lib/digester.js'
import { RemoteKeyStorage } from '../lib/remotekeystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { DomainBlocker } from '../lib/domainblocker.js'
import { SafeFetcher } from '../lib/safefetcher.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from '../lib/activitystreams.js'
import { RequestThrottler } from '../lib/requestthrottler.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'
import { signCavage } from './utils/cavage-signature.js'

describe('HTTPSignatureAuthenticator', async () => {
  const LOCAL_HOST = 'local.httpsignatureauthenticator.test'
  const REMOTE_HOST = 'social.httpsignatureauthenticator.test'
  const BLOCKED_HOST = 'blocked.httpsignatureauthenticator.test'
  const origin = `https://${LOCAL_HOST}`
  const LOCAL_USER = 'httpsignatureauthtestlocal'
  const BLOCKED_USER_1 = 'httpsignatureauthblocked1'
  const BLOCKED_USER_2 = 'httpsignatureauthblocked2'
  const BLOCKED_USER_3 = 'httpsignatureauthblocked3'
  const REMOTE_USER_1 = 'httpsignatureauthremote1'
  const REMOTE_USER_2 = 'httpsignatureauthremote2'
  const REMOTE_USER_3 = 'httpsignatureauthremote3'
  const REMOTE_USER_4 = 'httpsignatureauthremote4'
  const REMOTE_USER_6 = 'httpsignatureauthremote6'
  const REMOTE_USER_7 = 'httpsignatureauthremote7'
  const REMOTE_USER_8 = 'httpsignatureauthremote8'
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
  let messageSigner = null
  let digester = null
  let formatter = null
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
      assert.strictEqual(err.status, 401, `expected status 401, got ${err.status}`)
    } else {
      assert.fail('Passed through an incorrect request')
    }
  }
  const blockedNext = (err) => {
    if (err) {
      assert.strictEqual(err.status, 403, `expected status 403, got ${err.status}`)
    } else {
      assert.fail('Passed through a request from a blocked domain')
    }
  }
  const domainBlocker = {
    isBlocked: async (url) => String(url).includes(BLOCKED_HOST)
  }
  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, BLOCKED_HOST]
    })
    signer = new HTTPSignature(logger)
    messageSigner = new HTTPMessageSignature(logger)
    digester = new Digester(logger)
    formatter = new UrlFormatter(origin)
    const keyStorage = new KeyStorage(connection, logger)
    const throttler = new RequestThrottler(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    const policyStorage = new SignaturePolicyStorage(connection, logger)
    const client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, throttler, remoteObjectCache, messageSigner, policyStorage, new SafeFetcher(new DomainBlocker(null, connection, logger), { allowPrivate: true }), new DomainBlocker(null, connection, logger))
    remoteKeyStorage = new RemoteKeyStorage(client, connection, logger)
    nockSetup(REMOTE_HOST)
    nockSetup(BLOCKED_HOST)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST, BLOCKED_HOST]
    })
    await connection.close()
  })

  it('can initialize', async () => {
    authenticator = new HTTPSignatureAuthenticator(
      remoteKeyStorage,
      signer,
      messageSigner,
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText,
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText,
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText,
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('skips signature check for a bot with checkSignature false', async () => {
    const username = 'no-check-bot'
    const originalUrl = `/user/${username}/outbox`
    const method = 'GET'
    const headers = {
      date: new Date().toUTCString(),
      signature: 'NOT_A_SIGNATURE',
      host: URL.parse(origin).host
    }
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: {
        locals: {
          formatter,
          origin,
          bots: {
            [username]: { checkSignature: false }
          },
          domainBlocker
        }
      }
    }
    const res = {}
    await authenticator.authenticate(req, res, next)
  })

  it('can authenticate a valid RFC 9421 GET request with a full key URL', async () => {
    const username = REMOTE_USER_4
    const keyId = nockFormatDefault({ username, key: true })
    const url = OUTBOX_URL
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: REMOTE_HOST
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can authenticate a valid RFC 9421 POST request with a full key URL', async () => {
    const username = REMOTE_USER_6
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormatDefault({ username, type }),
      type
    })
    const rawBodyText = await activity.write()
    const hash = crypto.createHash('sha256').update(rawBodyText).digest('base64')
    const contentDigest = `sha-256=:${hash}:`
    const keyId = nockFormatDefault({ username, key: true })
    const method = 'POST'
    const originalUrl = INBOX_PATH
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      method,
      url: `${origin}${originalUrl}`,
      contentDigest,
      username,
      keyId,
      domain: REMOTE_HOST
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      'content-digest': contentDigest,
      host: URL.parse(origin).host
    }
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText,
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, next)
  })

  it('can authenticate a valid draft-cavage GET request after key rotation', async () => {
    const username = REMOTE_USER_7
    const date = new Date().toUTCString()
    const signature = await nockSignatureDefault({ url: OUTBOX_URL, date, username })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, next)
    await nockKeyRotateDefault(username)
    const date2 = new Date().toUTCString()
    const signature2 = await nockSignatureDefault({ url: OUTBOX_URL, date: date2, username })
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
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req2, res, next)
  })

  it('can authenticate a valid RFC 9421 GET request after key rotation', async () => {
    const username = REMOTE_USER_8
    const keyId = nockFormatDefault({ username, key: true })
    const url = OUTBOX_URL
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: REMOTE_HOST
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      host: URL.parse(origin).host
    }
    const method = 'GET'
    const originalUrl = OUTBOX_PATH
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, next)
    await nockKeyRotateDefault(username)
    const { 'signature-input': signatureInput2, signature: signature2 } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: REMOTE_HOST
    })
    const headers2 = {
      'signature-input': signatureInput2,
      signature: signature2,
      host: URL.parse(origin).host
    }
    const req2 = {
      headers: headers2,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req2, res, next)
  })

  it('can refuse a request with a future date outside of the skew window', async () => {
    const username = REMOTE_USER_1
    // 10 days from now
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
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, failNext)
  })

  it('refuses a GET request signed by a blocked domain', async () => {
    const username = BLOCKED_USER_1
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: OUTBOX_URL,
      date,
      username,
      domain: BLOCKED_HOST
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const res = {}
    const req = {
      headers,
      originalUrl: OUTBOX_PATH,
      method: 'GET',
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, blockedNext)
  })

  it('refuses a POST request signed by a blocked domain', async () => {
    const username = BLOCKED_USER_2
    const type = 'Activity'
    const activity = await as2.import({
      id: nockFormat({ username, type, domain: BLOCKED_HOST }),
      type
    })
    const rawBodyText = await activity.write()
    const digest = await digester.digest(rawBodyText)
    const date = new Date().toUTCString()
    const method = 'POST'
    const originalUrl = INBOX_PATH
    const signature = await nockSignature({
      username,
      url: `${origin}${originalUrl}`,
      date,
      digest,
      method,
      domain: BLOCKED_HOST
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host,
      digest
    }
    const res = {}
    const req = {
      headers,
      originalUrl,
      method,
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      rawBodyText,
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, blockedNext)
  })

  it('refuses an RFC 9421 GET request signed by a blocked domain', async () => {
    const username = BLOCKED_USER_3
    const keyId = nockFormat({ username, key: true, domain: BLOCKED_HOST })
    const url = OUTBOX_URL
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: BLOCKED_HOST
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      host: URL.parse(origin).host
    }
    const res = {}
    const req = {
      headers,
      originalUrl: OUTBOX_PATH,
      method: 'GET',
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, blockedNext)
  })

  it('refuses a blocked domain before fetching its key', async () => {
    const date = new Date().toUTCString()
    const keyId = `https://${BLOCKED_HOST}/users/nokey#main-key`
    const signature =
      `keyId="${keyId}",algorithm="rsa-sha256",` +
      'headers="(request-target) host date",signature="bm90LWEtc2lnbmF0dXJl"'
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const res = {}
    const req = {
      headers,
      originalUrl: OUTBOX_PATH,
      method: 'GET',
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, blockedNext)
  })

  it('allows a request from a non-blocked domain when a domain blocker is present', async () => {
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
    const res = {}
    const req = {
      headers,
      originalUrl: OUTBOX_PATH,
      method: 'GET',
      get: function (name) {
        return this.headers[name.toLowerCase()]
      },
      app: { locals: { formatter, origin, bots: {}, domainBlocker } }
    }
    await authenticator.authenticate(req, res, next)
  })
})

describe('HTTPSignatureAuthenticator Draft Cavage timestamp freshness', () => {
  const origin = 'https://authenticator.example'
  const host = 'authenticator.example'
  const path = '/user/receiver/outbox'
  const owner = 'https://remote.example/user/signer'
  const keyId = `${owner}#main-key`
  const now = 1800000000
  const date = new Date(now * 1000).toUTCString()
  const target = `(request-target): get ${path}\nhost: ${host}`
  let privateKey
  let authenticator

  before(() => {
    const keys = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    privateKey = keys.privateKey
    const logger = Logger({ level: 'silent' })
    const remoteKeyStorage = {
      async getPublicKey (id, cache = true) {
        assert.strictEqual(id, keyId)
        return { owner, publicKeyPem: keys.publicKey }
      }
    }
    authenticator = new HTTPSignatureAuthenticator(
      remoteKeyStorage,
      new HTTPSignature(logger),
      new HTTPMessageSignature(logger),
      new Digester(logger),
      logger
    )
  })

  function makeRequest (signedHeaders, signingString, parameters, requestDate = date) {
    const signature = signCavage(
      privateKey,
      signingString,
      `keyId="${keyId}",algorithm="hs2019",headers="${signedHeaders}",${parameters}`
    )
    const headers = { host, signature }
    if (requestDate !== null) {
      headers.date = requestDate
    }
    return {
      method: 'GET',
      originalUrl: path,
      headers,
      get (name) {
        return this.headers[name.toLowerCase()]
      },
      app: {
        locals: {
          origin,
          formatter: new UrlFormatter(origin),
          bots: {},
          domainBlocker: { async isBlocked (url) { return false } }
        }
      }
    }
  }

  async function assertAuthentication (t, req, expectedStatus = null) {
    t.mock.method(Date, 'now', () => now * 1000)
    const next = t.mock.fn()
    await authenticator.authenticate(req, {}, next)
    assert.strictEqual(next.mock.callCount(), 1)
    const [err] = next.mock.calls[0].arguments
    if (expectedStatus === null) {
      assert.ifError(err)
      assert.strictEqual(req.auth.subject, owner)
    } else {
      assert.ok(err, 'expected authentication to fail')
      assert.strictEqual(err.status, expectedStatus)
      assert.strictEqual(req.auth?.subject, undefined)
    }
  }

  for (const { label, created, expires, status } of [
    { label: 'accepts fresh created and future expires', created: now - 1, expires: now + 60 },
    { label: 'accepts created at the five-minute freshness boundary', created: now - 300, expires: now + 60 },
    { label: 'rejects stale created despite a fresh Date', created: now - 301, expires: now + 60, status: 401 },
    { label: 'rejects created beyond the future clock-skew window', created: now + 301, expires: now + 600, status: 401 },
    { label: 'rejects expired signatures despite fresh created and Date', created: now - 1, expires: now - 1, status: 401 },
    { label: 'accepts expires at the current time', created: now - 1, expires: now },
    { label: 'accepts expires more than five minutes in the future', created: now - 1, expires: now + 3600 }
  ]) {
    it(label, async (t) => {
      const req = makeRequest(
        '(request-target) host (created) (expires)',
        `${target}\n(created): ${created}\n(expires): ${expires}`,
        `created=${created},expires=${expires}`
      )
      await assertAuthentication(t, req, status ?? null)
    })
  }

  it('accepts signed created without a Date header or expires', async (t) => {
    const req = makeRequest(
      '(request-target) host (created)',
      `${target}\n(created): ${now}`,
      `created=${now}`,
      null
    )
    await assertAuthentication(t, req)
  })

  it('accepts a signed Date and expires without created', async (t) => {
    const req = makeRequest(
      '(request-target) host date (expires)',
      `${target}\ndate: ${date}\n(expires): ${now + 60}`,
      `expires=${now + 60}`
    )
    await assertAuthentication(t, req)
  })

  it('rejects an unsigned created parameter as a substitute for Date', async (t) => {
    const req = makeRequest(
      '(request-target) host',
      target,
      `created=${now}`,
      null
    )
    await assertAuthentication(t, req, 401)
  })

  it('rejects expires alone as a substitute for Date or signed created', async (t) => {
    const req = makeRequest(
      '(request-target) host (expires)',
      `${target}\n(expires): ${now + 60}`,
      `expires=${now + 60}`,
      null
    )
    await assertAuthentication(t, req, 401)
  })
})
